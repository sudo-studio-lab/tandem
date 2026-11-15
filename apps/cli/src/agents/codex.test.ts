/**
 * Codex adapter against a scripted fake `codex app-server` that speaks the documented protocol
 * (research B1–B4). The real thing is tested by @theroyatlas; this only pins our side of it.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalDecision } from "@tandem/contracts";
import type { AdapterEvent, ApprovalRequest } from "./types.ts";

type Msg = Record<string, any>;
interface Fake extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  pid: number;
  args: string[];
  got: Msg[];
}
const fakes: Fake[] = [];
/** How the fake server answers each client message. */
let server: (f: Fake, m: Msg) => void = () => {};

vi.mock("./proc.ts", async (orig) => ({
  ...(await orig<typeof import("./proc.ts")>()),
  spawnAgent: (_cmd: string, args: string[]) => {
    const f = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      pid: 1,
      args,
      got: [] as Msg[],
    });
    let buf = "";
    f.stdin.on("data", (d) => {
      buf += String(d);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const m = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        f.got.push(m);
        server(f, m);
      }
    });
    fakes.push(f);
    return f;
  },
  killTree: (f: Fake) => {
    f.exitCode = 1;
    f.emit("close", 1);
  },
}));

const { codexAdapter } = await import("./codex.ts");
const send = (f: Fake, m: Msg) => f.stdout.write(`${JSON.stringify(m)}\n`);
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("codex adapter", () => {
  it("runs a turn: thread/start, turn/start, streaming, approvals answered, MCP passed with -c", async () => {
    const approvals: ApprovalRequest[] = [];
    const events: AdapterEvent[] = [];
    server = (f, m) => {
      if (m.method === "initialize") send(f, { id: m.id, result: { userAgent: "codex/1" } });
      if (m.method === "thread/start") send(f, { id: m.id, result: { thread: { id: "T1" } } });
      if (m.method === "turn/start") {
        send(f, { id: m.id, result: { turn: { id: "U1" } } });
        send(f, { method: "turn/started", params: { turn: { id: "U1" } } });
        send(f, { method: "item/agentMessage/delta", params: { itemId: "I1", delta: "好" } });
        send(f, { method: "item/started", params: { item: { type: "commandExecution", id: "C1", command: "npm test", cwd: "/r" } } });
        send(f, { id: 99, method: "item/commandExecution/requestApproval", params: { itemId: "C1", threadId: "T1", turnId: "U1", command: "npm test" } });
      }
      if (m.id === 99 && m.result) {
        send(f, { method: "item/completed", params: { item: { type: "commandExecution", id: "C1", command: "npm test", status: "completed", exitCode: 0, aggregatedOutput: "ok" } } });
        send(f, { method: "item/completed", params: { item: { type: "agentMessage", id: "I1", text: "好了" } } });
        send(f, { method: "turn/completed", params: { turn: { id: "U1", status: "completed" } } });
      }
    };
    const s = codexAdapter.start({
      chatId: "c",
      cwd: "/r",
      model: "gpt-5",
      mcp: { command: "C:\\Program Files\\Tandem\\Tandem.exe", args: ["C:\\x\\bin.mjs", "mcp"], env: { ELECTRON_RUN_AS_NODE: "1" } },
      requestApproval: async (r): Promise<ApprovalDecision> => {
        approvals.push(r);
        return "allowSession";
      },
      onEvent: (e) => events.push(e),
    });
    await s.send("跑測試");
    await flush();
    const f = fakes.at(-1)!;
    expect(f.args.slice(-1)).toEqual(["app-server"]);
    expect(f.args).toEqual(
      expect.arrayContaining([
        "mcp_servers.tandem.command='C:\\Program Files\\Tandem\\Tandem.exe'",
        "mcp_servers.tandem.args=['C:\\x\\bin.mjs','mcp']",
        "mcp_servers.tandem.env={ELECTRON_RUN_AS_NODE='1'}",
      ]),
    );
    const methods = f.got.map((m) => m.method ?? `reply:${m.id}`);
    expect(methods).toEqual(["initialize", "initialized", "thread/start", "turn/start", "reply:99"]);
    expect(f.got[0]).not.toHaveProperty("jsonrpc");
    expect(f.got[2]!.params).toEqual({ cwd: "/r", model: "gpt-5" });
    expect(f.got[3]!.params).toEqual({ threadId: "T1", input: [{ type: "text", text: "跑測試" }] });
    expect(f.got[4]!.result).toEqual({ decision: "acceptForSession" });
    expect(approvals[0]).toMatchObject({ name: "執行指令", summary: "npm test" });
    expect(events).toEqual([
      { type: "session", agentSessionId: "T1" },
      { type: "text", id: "I1", delta: "好" },
      { type: "tool", id: "C1", name: "指令", summary: "npm test", input: { command: "npm test", cwd: "/r" }, status: "running", output: undefined },
      { type: "tool", id: "C1", name: "指令", summary: "npm test", input: { command: "npm test", cwd: undefined }, status: "done", output: "ok" },
      { type: "message", id: "I1", text: "好了" },
      { type: "turnDone" },
    ]);
  });

  it("resumes an existing thread and interrupts the running turn", async () => {
    server = (f, m) => {
      if (m.method === "initialize") send(f, { id: m.id, result: {} });
      if (m.method === "thread/resume") send(f, { id: m.id, result: { thread: { id: "T9" } } });
      if (m.method === "turn/start") send(f, { id: m.id, result: { turn: { id: "U9" } } });
      if (m.method === "turn/interrupt") {
        send(f, { id: m.id, result: {} });
        send(f, { method: "turn/completed", params: { turn: { id: "U9", status: "interrupted" } } });
      }
    };
    const events: AdapterEvent[] = [];
    const s = codexAdapter.start({ chatId: "c", cwd: "/r", model: "", resumeId: "T9", mcp: { command: "t", args: [], env: {} }, requestApproval: async () => "deny", onEvent: (e) => events.push(e) });
    await s.send("長任務");
    await flush();
    await s.interrupt();
    await flush();
    const f = fakes.at(-1)!;
    expect(f.got.find((m) => m.method === "thread/resume")!.params).toEqual({ threadId: "T9", cwd: "/r" });
    expect(f.got.find((m) => m.method === "turn/interrupt")!.params).toEqual({ threadId: "T9", turnId: "U9" });
    expect(events.at(-1)).toEqual({ type: "turnDone" });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });
});
