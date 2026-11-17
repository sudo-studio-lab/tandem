import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { AdapterEvent } from "./types.ts";

type Json = Record<string, any>;
interface Fake extends EventEmitter { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; got: Json[]; args: string[]; exitCode: null | number; pid: number }
const children: Fake[] = [];
let server: (child: Fake, message: Json) => void;
vi.mock("./proc.ts", async (original) => ({
  ...(await original<typeof import("./proc.ts")>()),
  resolveCommand: () => ({ file: "fake", prefix: [] }),
  spawnAgent: (_command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), got: [] as Json[], args, exitCode: null, pid: 1 }) as Fake;
    let buffer = "";
    child.stdin.on("data", (data) => {
      buffer += String(data);
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) { const message = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); child.got.push(message); server(child, message); }
    });
    children.push(child); return child;
  },
  killTree: (child: Fake) => { child.exitCode = 0; child.emit("close", 0); },
}));
const { createAcpAdapter, acpModels } = await import("./acp.ts");
const reply = (child: Fake, message: Json) => child.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const tick = () => new Promise((r) => setTimeout(r, 0));
function setup(options: { images?: boolean; load?: boolean } = {}) {
  server = (child, message) => {
    if (message.method === "initialize") reply(child, { id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: options.load ?? true, promptCapabilities: { image: options.images ?? true } } } });
    if (message.method === "session/new" || message.method === "session/load") reply(child, { id: message.id, result: { sessionId: message.params.sessionId ?? "S1", models: { availableModels: [{ modelId: "model-a", name: "Model A" }] } } });
    if (message.method === "session/set_model") reply(child, { id: message.id, result: {} });
  };
}

describe("ACP providers", () => {
  it("does not dispatch a delayed prompt after stop was requested during initialization", async () => {
    setup(); const original = server;
    server = (child, message) => { if (message.method === "initialize") setTimeout(() => original(child, message), 10); else original(child, message); };
    const session = createAcpAdapter("grok").start({ chatId: "cancel-start", cwd: "/r", model: "", mcp: { command: "t", args: [], env: {} }, requestApproval: async () => "deny", onEvent: () => {} });
    const sending = session.send("不要在停止後執行");
    await session.interrupt(); await sending;
    expect(children.at(-1)!.got.some((m) => m.method === "session/prompt")).toBe(false);
    await session.close();
  });
  it("does not offer fast variants or an opaque Cursor default", () => {
    const session = { models: { currentModelId: "default[]", availableModels: [{ modelId: "default[]" }, { modelId: "composer[fast=true]" }, { modelId: "opus[fast=false]" }, { modelId: "grok-build-fast" }] } };
    expect(acpModels(session, "cursor").map((m) => m.id)).toEqual(["opus[fast=false]"]);
  });
  it.each(["grok", "cursor", "antigravity"] as const)("%s discovers auth and model metadata without sending a prompt", async (kind) => {
    setup(); const status = await createAcpAdapter(kind).status();
    expect(status).toMatchObject({ agent: kind, auth: "authenticated", supportsImages: true, supportsSteer: false });
    expect(status.models.map((m) => m.id)).toEqual(kind === "cursor" ? ["model-a"] : ["", "model-a"]);
    expect(children.at(-1)!.got.some((m) => m.method === "session/prompt")).toBe(false);
  });

  it("streams images as ACP blocks, passes MCP per session, and maps permission options without guessing ids", async () => {
    setup(); const initial = server;
    const events: AdapterEvent[] = [];
    server = (child, message) => {
      initial(child, message);
      if (message.method === "session/prompt") {
        reply(child, { method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "收到圖片" } } } });
        reply(child, { id: 90, method: "session/request_permission", params: { sessionId: "S1", toolCall: { title: "修改檔案", rawInput: { path: "a.ts" } }, options: [{ kind: "allow_once", optionId: "yes-specific" }, { kind: "reject_once", optionId: "no-specific" }] } });
      }
      if (message.id === 90 && message.result) {
        const prompt = child.got.find((m) => m.method === "session/prompt")!;
        reply(child, { id: prompt.id, result: { stopReason: "end_turn" } });
      }
    };
    const session = createAcpAdapter("grok").start({ chatId: "c", cwd: "/repo", model: "model-a", mcp: { command: "tandem", args: ["mcp"], env: { SAMPLE: "value" } }, requestApproval: async () => "deny", onEvent: (e) => events.push(e) });
    await session.send("這是圖片", [{ id: "i", name: "a.png", dataUrl: "data:image/png;base64,aGVsbG8=" }]);
    await tick();
    const child = children.at(-1)!;
    expect(child.got[0]).toMatchObject({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
    expect(child.got.find((m) => m.method === "session/new")!.params.mcpServers).toEqual([{ name: "tandem", command: "tandem", args: ["mcp"], env: [{ name: "SAMPLE", value: "value" }] }]);
    expect(child.got.find((m) => m.method === "session/prompt")!.params.prompt).toEqual([{ type: "text", text: "這是圖片" }, { type: "image", mimeType: "image/png", data: "aGVsbG8=" }]);
    expect(child.got.find((m) => m.id === 90)!.result.outcome).toEqual({ outcome: "selected", optionId: "no-specific" });
    expect(events.some((e) => e.type === "text" && e.delta === "收到圖片")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "turnDone" });
    await session.close();
  });

  it("refuses unsupported image input and never silently opens a new session in place of a lost history", async () => {
    setup({ images: false, load: false });
    const opts = { chatId: "c", cwd: "/repo", model: "model-a", mcp: { command: "tandem", args: [], env: {} }, requestApproval: async () => "deny" as const, onEvent: () => {} };
    const resumed = createAcpAdapter("cursor").start({ ...opts, resumeId: "old" });
    await expect(resumed.send("繼續")).rejects.toThrow(/不支援恢復/);
    expect(children.at(-1)!.got.some((m) => m.method === "session/new")).toBe(false);
    const fresh = createAcpAdapter("cursor").start(opts);
    await expect(fresh.send("", [{ id: "i", name: "a.png", dataUrl: "data:image/png;base64,aGVsbG8=" }])).rejects.toThrow(/未提供圖片/);
    await fresh.close();
  });
});
