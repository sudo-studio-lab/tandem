import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApprovalDecision, ChatUpdate } from "@tandem/contracts";
import type { AgentAdapter, StartOptions } from "../agents/types.ts";
import { ChatManager } from "./manager.ts";

let dir: string;
let updates: ChatUpdate[];
let started: StartOptions[];
let sent: string[];
let interrupted: number;

/** A scripted agent: `script(text, opts)` runs for every message. */
function fakeAdapter(script: (text: string, o: StartOptions) => Promise<void> | void): AgentAdapter {
  return {
    kind: "claude",
    status: async () => ({ agent: "claude", label: "Claude", installed: true, auth: "subscription", models: [], installUrl: "" }),
    login: async () => ({ message: "" }),
    logout: async () => {},
    start(o) {
      started.push(o);
      return {
        send: async (text) => {
          sent.push(text);
          await script(text, o);
        },
        interrupt: async () => {
          interrupted += 1;
          o.onEvent({ type: "exit" });
        },
        close: async () => {},
      };
    },
  };
}

function manager(script: Parameters<typeof fakeAdapter>[0]) {
  const a = fakeAdapter(script);
  return new ChatManager({
    adapters: { claude: a, codex: a },
    emit: (u) => updates.push(u),
    mcp: () => ({ command: "node", args: ["x", "mcp"], env: {} }),
    approveBridge: () => ({ url: "http://127.0.0.1:1/internal/approve", token: "t" }),
    dir,
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tandem-chats-"));
  updates = [];
  started = [];
  sent = [];
  interrupted = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("chat manager", () => {
  it("streams a reply, records tools, keeps the agent session id and saves to disk", async () => {
    const m = manager((_t, o) => {
      o.onEvent({ type: "session", agentSessionId: "sess-1" });
      o.onEvent({ type: "text", id: "m1:t0", delta: "你" });
      o.onEvent({ type: "text", id: "m1:t0", delta: "好" });
      o.onEvent({ type: "message", id: "m1:t0", text: "你好" });
      o.onEvent({ type: "tool", id: "tu1", name: "Bash", summary: "ls", input: { command: "ls" }, status: "running" });
      o.onEvent({ type: "tool", id: "tu1", name: "", summary: "", status: "done", output: "a.txt" });
      o.onEvent({ type: "turnDone", costUsd: 0.01 });
    });
    const c = await m.create("o/r", "claude", "haiku");
    await m.send(c.id, "  嗨，幫我看檔案  ", "C:/repo");
    const chat = await m.get(c.id);
    expect(chat.title).toBe("嗨，幫我看檔案");
    expect(chat.agentSessionId).toBe("sess-1");
    expect(chat.running).toBe(false);
    expect(chat.costUsd).toBeCloseTo(0.01);
    expect(chat.items.map((i) => i.kind)).toEqual(["user", "assistant", "tool"]);
    const tool = chat.items[2]!;
    expect(tool.kind === "tool" && [tool.name, tool.summary, tool.status, tool.output]).toEqual(["Bash", "ls", "done", "a.txt"]);
    expect(updates.filter((u) => u.type === "delta").map((u) => (u as { text: string }).text)).toEqual(["好"]);
    expect(started[0]!.model).toBe("haiku");
    expect(started[0]!.cwd).toBe("C:/repo");
    expect(started[0]!.approveBridge?.token).toBe("t");

    await m.flush();
    const saved = JSON.parse(await readFile(path.join(dir, `${c.id}.json`), "utf8"));
    expect(saved.items).toHaveLength(3);

    // A new manager (app restart) sees the chat and resumes the same agent conversation.
    const m2 = manager(() => {});
    expect((await m2.list("o/r")).map((x) => x.id)).toEqual([c.id]);
    await m2.send(c.id, "繼續", "C:/repo");
    expect(started[1]!.resumeId).toBe("sess-1");
  });

  it("refuses a second message while the agent is still replying", async () => {
    const m = manager(() => {});
    const c = await m.create("o/r", "claude", "");
    await m.send(c.id, "一", "C:/repo");
    await expect(m.send(c.id, "二", "C:/repo")).rejects.toThrow(/還在回覆/);
  });

  it("holds approvals until the user answers; allowSession skips later ones", async () => {
    const decisions: ApprovalDecision[] = [];
    const m = manager(async (_t, o) => {
      decisions.push(await o.requestApproval({ name: "Write", summary: "a.txt", input: { file_path: "a.txt" } }));
      decisions.push(await o.requestApproval({ name: "Write", summary: "b.txt" }));
      o.onEvent({ type: "turnDone" });
    });
    const c = await m.create("o/r", "claude", "");
    const sending = m.send(c.id, "寫檔", "C:/repo");
    await tick();
    const pending = (await m.get(c.id)).items.find((i) => i.kind === "approval");
    expect(pending?.kind === "approval" && pending.state).toBe("pending");
    await m.answer(c.id, pending!.id, "allowSession");
    await sending;
    expect(decisions).toEqual(["allowSession", "allow"]);
    const approvals = (await m.get(c.id)).items.filter((i) => i.kind === "approval");
    expect(approvals.map((a) => a.kind === "approval" && [a.state, a.note])).toEqual([
      ["allowed", "這段對話都同意"],
      ["allowed", "這段對話都同意"],
    ]);
    await expect(m.answer(c.id, pending!.id, "deny")).rejects.toThrow(/已經處理過/);
  });

  it("stop denies pending approvals, ends the turn and says so", async () => {
    let decision: ApprovalDecision | undefined;
    const m = manager(async (_t, o) => {
      void o.requestApproval({ name: "Bash", summary: "rm -rf x" }).then((d) => (decision = d));
    });
    const c = await m.create("o/r", "claude", "");
    await m.send(c.id, "刪掉", "C:/repo");
    await tick();
    await m.interrupt(c.id);
    await tick();
    expect(decision).toBe("deny");
    expect(interrupted).toBe(1);
    const chat = await m.get(c.id);
    expect(chat.running).toBe(false);
    expect(chat.items.at(-1)?.kind).toBe("notice");
  });

  it("deletes a chat and its file", async () => {
    const m = manager(() => {});
    const c = await m.create("o/r", "claude", "");
    await m.flush();
    await m.remove(c.id);
    expect(await m.list("o/r")).toEqual([]);
    await expect(readFile(path.join(dir, `${c.id}.json`), "utf8")).rejects.toThrow();
    expect(updates.at(-1)).toEqual({ chatId: c.id, type: "deleted" });
  });
});
