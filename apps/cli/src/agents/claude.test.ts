import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterEvent } from "./types.ts";

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  pid: number;
  args: string[];
}
const children: FakeChild[] = [];

vi.mock("./proc.ts", async (orig) => ({
  ...(await orig<typeof import("./proc.ts")>()),
  spawnAgent: (_cmd: string, args: string[]) => {
    const c = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      pid: 1,
      args,
    });
    children.push(c);
    return c;
  },
  killTree: (c: FakeChild) => {
    c.exitCode = 1;
    c.emit("close", 1);
  },
}));

const { claudeAdapter } = await import("./claude.ts");

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "tandem-claude-"));
  process.env.TANDEM_HOME = home;
  children.length = 0;
});
afterEach(async () => {
  delete process.env.TANDEM_HOME;
  await rm(home, { recursive: true, force: true });
});

const line = (c: FakeChild, j: unknown) => c.stdout.write(`${JSON.stringify(j)}\n`);
const flush = () => new Promise((r) => setTimeout(r, 10));

describe("claude adapter", () => {
  it("starts claude with stream-json, our MCP server and the approve tool; maps the stream to events", async () => {
    const events: AdapterEvent[] = [];
    const s = claudeAdapter.start({
      chatId: "c1",
      cwd: home,
      model: "sonnet",
      mcp: { command: "node", args: ["bin.js", "mcp"], env: { ELECTRON_RUN_AS_NODE: "1" } },
      approveBridge: { url: "http://127.0.0.1:9/internal/approve", token: "tok" },
      requestApproval: async () => "deny",
      onEvent: (e) => events.push(e),
    });
    await s.send("嗨");
    const c = children[0]!;
    expect(c.args).toEqual(expect.arrayContaining(["-p", "--input-format", "stream-json", "--permission-prompt-tool", "mcp__tandem__approve", "--model", "sonnet"]));
    expect(c.args).not.toContain("--resume");
    // The approve token is in a file under the app folder, not on the command line.
    expect(c.args.join(" ")).not.toContain("tok");
    const cfgPath = c.args[c.args.indexOf("--mcp-config") + 1]!;
    const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
    expect(cfg.mcpServers.tandem).toEqual({
      command: "node",
      args: ["bin.js", "mcp"],
      env: { ELECTRON_RUN_AS_NODE: "1", TANDEM_APPROVE_URL: "http://127.0.0.1:9/internal/approve", TANDEM_APPROVE_TOKEN: "tok", TANDEM_CHAT_ID: "c1" },
    });
    expect(JSON.parse(String(c.stdin.read()))).toEqual({ type: "user", message: { role: "user", content: "嗨" } });

    line(c, { type: "system", subtype: "hook_started", session_id: "S1" });
    line(c, { type: "stream_event", event: { type: "message_start", message: { id: "M1" } }, session_id: "S1" });
    line(c, { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use" } } });
    line(c, { type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "text" } } });
    line(c, { type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "好" } } });
    // Claude Code sends one `assistant` event per block; the text is this message's first text block.
    line(c, { type: "assistant", message: { id: "M1", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }] } });
    line(c, { type: "assistant", message: { id: "M1", content: [{ type: "text", text: "好的" }] } });
    line(c, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "a.txt" }], is_error: false }] } });
    line(c, { type: "result", subtype: "success", is_error: false, result: "好的", total_cost_usd: 0.02, session_id: "S1" });
    await flush();

    expect(events).toEqual([
      { type: "session", agentSessionId: "S1" },
      { type: "text", id: "M1:t0", delta: "好" },
      { type: "tool", id: "tu1", name: "Bash", summary: "ls", input: { command: "ls" }, status: "running" },
      { type: "message", id: "M1:t0", text: "好的" },
      { type: "tool", id: "tu1", name: "", summary: "", status: "done", output: "a.txt" },
      { type: "turnDone", costUsd: 0.02 },
    ]);
  });

  it("stop kills the process quietly; the next message resumes the same session", async () => {
    const events: AdapterEvent[] = [];
    const s = claudeAdapter.start({
      chatId: "c2",
      cwd: home,
      model: "",
      resumeId: "OLD",
      mcp: { command: "node", args: [], env: {} },
      requestApproval: async () => "deny",
      onEvent: (e) => events.push(e),
    });
    await s.send("一");
    expect(children[0]!.args).toEqual(expect.arrayContaining(["--resume", "OLD"]));
    expect(children[0]!.args).not.toContain("--permission-prompt-tool");
    line(children[0]!, { type: "system", subtype: "init", session_id: "NEW" });
    await flush();
    await s.interrupt();
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "exit" });
    await s.send("二");
    expect(children[1]!.args).toEqual(expect.arrayContaining(["--resume", "NEW"]));
  });

  it("explains a usage-limit error in plain words", async () => {
    const events: AdapterEvent[] = [];
    const s = claudeAdapter.start({ chatId: "c3", cwd: home, model: "", mcp: { command: "n", args: [], env: {} }, requestApproval: async () => "deny", onEvent: (e) => events.push(e) });
    await s.send("x");
    line(children[0]!, { type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1763200000" });
    await flush();
    const err = events.find((e) => e.type === "error");
    expect(err?.type === "error" && err.message).toMatch(/額度用完/);
  });
});
