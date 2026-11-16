import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApprovalDecision, ChatImage, ChatUpdate } from "@tandem/contracts";
import type { AgentAdapter, StartOptions } from "../agents/types.ts";
import { ChatManager } from "./manager.ts";

let dir: string;
let updates: ChatUpdate[];
let started: StartOptions[];
let sent: string[];
let interrupted: number;
let receivedImages: (ChatImage[] | undefined)[];
let steered: string[];

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
        send: async (text, images) => {
          sent.push(text);
          receivedImages.push(images);
          await script(text, o);
        },
        steer: async (text) => { steered.push(text); },
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
    adapters: { claude: a, codex: a, antigravity: a, grok: a, cursor: a },
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
  receivedImages = [];
  steered = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("chat manager", () => {
  it("keeps steer separate from queued turns and rejects it when idle", async () => {
    const m = manager(() => {}); const c = await m.create("o/r", "codex", "");
    await expect(m.steer(c.id, "還沒開始")).rejects.toThrow(/無法即時補充/);
    await m.send(c.id, "目前工作", "C:/repo");
    await m.enqueue(c.id, "下一回合", "C:/repo");
    await m.steer(c.id, "修正當前方向");
    expect(steered).toEqual(["修正當前方向"]);
    expect(sent).toEqual(["目前工作"]);
    expect((await m.get(c.id)).queue?.map((q) => q.text)).toEqual(["下一回合"]);
    expect((await m.get(c.id)).items.at(-1)).toMatchObject({ kind: "user", text: "修正當前方向" });
    await m.closeAll();
  });

  it("preserves native assistant image blocks through later text and final-message events", async () => {
    const image = { id: "picture", name: "provider.png", dataUrl: "data:image/png;base64,aGVsbG8=" };
    const m = manager((_text, o) => {
      o.onEvent({ type: "image", id: "answer", image });
      o.onEvent({ type: "text", id: "answer", delta: "圖片說明" });
      o.onEvent({ type: "message", id: "answer", text: "最後圖片說明" });
      o.onEvent({ type: "turnDone" });
    });
    const c = await m.create("o/r", "claude", ""); await m.send(c.id, "顯示圖片", "C:/repo");
    expect((await m.get(c.id)).items.at(-1)).toMatchObject({ kind: "assistant", text: "最後圖片說明", images: [image], streaming: false });
    await m.closeAll();
  });

  it("queues in order, only sending the next message after the active turn completes", async () => {
    const m = manager(() => {});
    const c = await m.create("o/r", "codex", "");
    await m.send(c.id, "先做", "C:/repo");
    await m.enqueue(c.id, "第二則", "C:/repo"); await m.enqueue(c.id, "第三則", "C:/repo");
    expect(sent).toEqual(["先做"]);
    started[0]!.onEvent({ type: "turnDone" }); await tick();
    expect(sent).toEqual(["先做", "第二則"]);
    expect((await m.get(c.id)).queue?.map((q) => q.text)).toEqual(["第三則"]);
    started[0]!.onEvent({ type: "turnDone" }); await tick();
    expect(sent).toEqual(["先做", "第二則", "第三則"]);
    await m.closeAll();
  });

  it("edits and removes waiting messages; stop pauses the queue until explicitly resumed", async () => {
    const m = manager(() => {}); const c = await m.create("o/r", "codex", "");
    await m.send(c.id, "先做", "C:/repo");
    await m.enqueue(c.id, "原草稿", "C:/repo"); await m.enqueue(c.id, "不要這則", "C:/repo");
    const [first, second] = (await m.get(c.id)).queue!;
    await m.updateQueued(c.id, first!.id, { text: "修正的下一則", images: [] });
    await m.updateQueued(c.id, second!.id);
    await m.interrupt(c.id); await tick();
    expect(sent).toEqual(["先做"]);
    expect((await m.get(c.id)).queuePaused).toBe(true);
    await m.resumeQueue(c.id, "C:/repo"); await tick();
    expect(sent).toEqual(["先做", "修正的下一則"]);
    await m.closeAll();
  });

  it("keeps waiting messages on restart and pauses the queue on a provider error", async () => {
    const m = manager((text, o) => { if (text === "會失敗") { o.onEvent({ type: "error", message: "額度不足" }); o.onEvent({ type: "turnDone" }); } });
    const c = await m.create("o/r", "codex", "");
    await m.send(c.id, "先做", "C:/repo");
    await m.enqueue(c.id, "會失敗", "C:/repo"); await m.enqueue(c.id, "保留這則", "C:/repo");
    started[0]!.onEvent({ type: "turnDone" }); await tick();
    expect(sent).toEqual(["先做", "會失敗"]);
    expect(await m.get(c.id)).toMatchObject({ queuePaused: true, queue: [{ text: "保留這則" }] });
    await m.closeAll();
    const restarted = manager(() => {});
    expect(await restarted.get(c.id)).toMatchObject({ running: false, queuePaused: true, queue: [{ text: "保留這則" }] });
    await restarted.closeAll();
  });

  it("preserves image-only messages on disk and forwards their bytes to the adapter", async () => {
    const m = manager((_text, o) => o.onEvent({ type: "turnDone" }));
    const c = await m.create("o/r", "codex", "");
    const images = [{ id: "i", name: "screen.png", dataUrl: "data:image/png;base64,aGVsbG8=" }];
    await m.send(c.id, "", "C:/repo", images);
    expect(receivedImages).toEqual([images]);
    expect((await m.get(c.id)).items[0]).toMatchObject({ kind: "user", text: "", images });
    await m.flush();
    expect((await manager(() => {}).get(c.id)).items[0]).toMatchObject({ images });
  });

  it("rejects unsupported or oversized attachments before recording a message", async () => {
    const m = manager(() => {});
    const c = await m.create("o/r", "codex", "");
    await expect(m.send(c.id, "", "C:/repo", [{ id: "i", name: "bad.svg", dataUrl: "data:image/svg+xml;base64,AAAA" }])).rejects.toThrow(/PNG/);
    await expect(m.send(c.id, "", "C:/repo", Array.from({ length: 5 }, () => ({})))).rejects.toThrow(/最多/);
    await expect(m.send(c.id, "", "C:/repo", [{ id: "i", name: "big.png", dataUrl: `data:image/png;base64,${"A".repeat(7_000_000)}` }])).rejects.toThrow(/5 MB/);
    expect((await m.get(c.id)).items).toEqual([]);
    await m.flush();
  });

  it("switches models between turns, keeps the original session and ignores old session events", async () => {
    const m = manager((_text, o) => { o.onEvent({ type: "session", agentSessionId: "same-session" }); o.onEvent({ type: "turnDone" }); });
    const c = await m.create("o/r", "codex", "old-model");
    await m.send(c.id, "第一句", "C:/repo");
    await m.configure(c.id, "new-model", "high");
    await m.send(c.id, "第二句", "C:/repo");
    expect(started[1]).toMatchObject({ model: "new-model", reasoningEffort: "high", resumeId: "same-session" });
    started[0]!.onEvent({ type: "session", agentSessionId: "stale-session" });
    expect((await m.get(c.id)).agentSessionId).toBe("same-session");
    expect((await m.get(c.id)).items.filter((x) => x.kind === "user")).toHaveLength(2);
    await m.flush();
    expect(await manager(() => {}).get(c.id)).toMatchObject({ model: "new-model", reasoningEffort: "high" });
  });

  it("does not switch a model during a running turn", async () => {
    const m = manager(() => {});
    const c = await m.create("o/r", "codex", "old-model");
    await m.send(c.id, "工作", "C:/repo");
    await expect(m.configure(c.id, "new-model")).rejects.toThrow(/完成/);
    expect((await m.get(c.id)).model).toBe("old-model");
    await m.flush();
  });

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
