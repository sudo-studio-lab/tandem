/** ACP v1 over stdio. Uses each vendor's own authenticated executable, never its credentials. */
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentKind, AgentStatus, ChatImage, ModelChoice } from "@tandem/contracts";
import { agentEnv, killTree, onLines, openTerminal, resolveCommand, spawnAgent } from "./proc.ts";
import type { AgentAdapter, AgentSession, StartOptions } from "./types.ts";
import { summarize, truncate } from "./types.ts";

type Json = Record<string, any>;
type AcpKind = Extract<AgentKind, "grok" | "cursor" | "antigravity">;
export const ACP_INFO = {
  grok: { label: "Grok", command: "grok", args: ["agent", "stdio"], installUrl: "https://x.ai/cli" },
  cursor: { label: "Cursor", command: "cursor-agent", args: ["acp"], installUrl: "https://cursor.com/docs/cli/installation" },
  antigravity: { label: "Antigravity", command: "agy", args: ["acp"], installUrl: "https://antigravity.google/docs/cli" },
} as const;

export function acpCommand(kind: AcpKind): { command: string; args: string[] } | null {
  const info = ACP_INFO[kind];
  const override = process.env[`TANDEM_${kind.toUpperCase()}_COMMAND`];
  if (override && (existsSync(override) || resolveCommand(override))) return { command: override, args: kind === "antigravity" && /acp.*\.exe$/i.test(override) ? [] : [...info.args] };
  if (resolveCommand(info.command)) return { command: info.command, args: [...info.args] };
  if (kind === "antigravity" && process.platform === "win32") {
    // Reuse the installed binary only. Do not copy T3's isolated profiles or credentials.
    const root = path.join(os.homedir(), ".t3", "tools", "antigravity-acp", "win32-x64");
    try {
      const { releaseId } = JSON.parse(readFileSync(path.join(root, "active.json"), "utf8"));
      if (typeof releaseId !== "string" || !/^[a-f0-9]{64}$/.test(releaseId)) return null;
      const command = path.join(root, "versions", releaseId, "agy_acp_server.exe");
      if (existsSync(command)) return { command, args: [] };
    } catch { /* No bundled executable; show install instructions. */ }
  }
  return null;
}

export class AcpPeer {
  private next = 1;
  private pending = new Map<number, { resolve(v: Json): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  onNotify: (method: string, params: Json) => void = () => {};
  onRequest: (method: string, params: Json) => Promise<Json> = async () => { throw new Error("Unsupported client request"); };
  onClose: () => void = () => {};
  private stderr = "";
  constructor(readonly child: ChildProcess) {
    onLines(child.stdout!, (line) => this.receive(line));
    child.stderr?.on("data", (d) => { this.stderr = (this.stderr + String(d)).slice(-2000); });
    const fail = (error: Error) => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
      this.pending.clear();
    };
    child.on("error", fail);
    child.on("close", () => { fail(new Error(`ACP 已結束${this.stderr ? `：${this.stderr.slice(-500)}` : ""}`)); this.onClose(); });
  }
  private write(value: Json) {
    if (!this.child.stdin?.writable) throw new Error("ACP 連線已關閉");
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
  }
  request(method: string, params: Json, timeout = 30_000): Promise<Json> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`ACP 沒有回應 ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  notify(method: string, params: Json) { this.write({ method, params }); }
  private receive(line: string) {
    let m: Json;
    try { m = JSON.parse(line); } catch { return; }
    if (m.method && m.id !== undefined) {
      void this.onRequest(m.method, m.params ?? {}).then(
        (result) => this.write({ id: m.id, result }),
        (e: Error) => this.write({ id: m.id, error: { code: -32601, message: e.message } }),
      ).catch(() => undefined);
    } else if (m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer); this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message ?? "ACP 回報錯誤")); else p.resolve(m.result ?? {});
    } else if (m.method) this.onNotify(m.method, m.params ?? {});
  }
  close() { killTree(this.child); }
}

async function connect(kind: AcpKind, cwd: string) {
  const launch = acpCommand(kind);
  if (!launch) throw new Error(`找不到 ${ACP_INFO[kind].label} 的 ACP 工具`);
  const peer = new AcpPeer(spawnAgent(launch.command, launch.args, { cwd, env: agentEnv() }));
  try {
    const init = await peer.request("initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "tandem", version: "0.2.1" } });
    return { peer, init };
  } catch (e) { peer.close(); throw e; }
}

const standardModel = (id: string) => !/fast=true|build-fast|fable/i.test(id) && !/^default(?:\[.*\])?$/.test(id);

export function acpModels(session: Json, kind?: AcpKind): ModelChoice[] {
  const config = (session.configOptions ?? []).find((c: Json) => c.category === "model" || c.id === "model");
  const options = config?.options?.flatMap((o: Json) => o.options ?? [o]);
  const models = session.models?.availableModels?.map((m: Json) => ({ id: m.modelId, label: m.name ?? m.modelId }))
    ?? options?.map((o: Json) => ({ id: o.value, label: o.name ?? o.value })) ?? [];
  const current = session.models?.currentModelId ?? config?.currentValue;
  const safe = models.filter((m: ModelChoice) => typeof m.id === "string" && m.id && standardModel(m.id));
  const canDefault = kind !== "cursor" && (!current || standardModel(current));
  return [...(canDefault ? [{ id: "", label: "預設", isDefault: true }] : []), ...safe];
}

export function createAcpAdapter(kind: AcpKind): AgentAdapter {
  const info = ACP_INFO[kind];
  return {
    kind,
    async status(): Promise<AgentStatus> {
      const base: AgentStatus = { agent: kind, label: info.label, installed: !!acpCommand(kind), auth: "none", models: [{ id: "", label: "預設", isDefault: true }], installUrl: info.installUrl, managedAuthExternally: true, supportsSteer: false, terminalAvailable: kind !== "antigravity" || !!resolveCommand("agy") };
      if (!base.installed) return base;
      let peer: AcpPeer | undefined;
      try {
        const connection = await connect(kind, process.cwd()); peer = connection.peer;
        // Creating a local empty session checks auth and the catalog. It sends no prompt.
        const session = await peer.request("session/new", { cwd: process.cwd(), mcpServers: [] });
        return { ...base, auth: "authenticated", version: connection.init.agentInfo?.version, models: acpModels(session, kind), supportsImages: connection.init.agentCapabilities?.promptCapabilities?.image === true };
      } catch (e) {
        const message = (e as Error).message;
        return { ...base, auth: /auth|login|credential|sign.in|登入|認證/i.test(message) ? "none" : "unknown", note: /auth|login|credential|sign.in|登入|認證/i.test(message) ? "請先在原廠工具完成登入" : `ACP 連線未完成：${message.slice(0, 180)}` };
      } finally { peer?.close(); }
    },
    async login(_method, cwd) {
      if (kind !== "antigravity") {
        const launch = acpCommand(kind);
        if (!launch) throw new Error(`請先安裝 ${info.label}`);
        openTerminal(cwd, [launch.command, "login"]);
      } else {
        const { peer, init } = await connect(kind, cwd);
        const method = init.authMethods?.find((m: Json) => m.id === "oauth-personal") ?? init.authMethods?.[0];
        if (!method) { peer.close(); throw new Error("這個 Antigravity runtime 沒有提供登入方法，請在原廠工具登入"); }
        void peer.request("authenticate", { methodId: method.id }, 10 * 60_000).catch(() => undefined).finally(() => peer.close());
      }
      return { terminal: kind !== "antigravity", message: `請在 ${info.label} 原廠工具完成登入，再按「重新檢查」。Tandem 不會收取憑證。` };
    },
    async logout() { throw new Error(`請在 ${info.label} 原廠工具管理登入與登出`); },
    start(opts) { return new AcpSession(kind, opts); },
  };
}

class AcpSession implements AgentSession {
  private peer?: AcpPeer;
  private starting?: Promise<AcpPeer>;
  private id?: string;
  private messageId = "";
  private closing = false;
  private images = false;
  private configs: Json[] = [];
  private turn?: Promise<void>;
  private cancelled = false;
  constructor(private kind: AcpKind, private opts: StartOptions) { this.id = opts.resumeId; }
  private ready(): Promise<AcpPeer> {
    return this.starting ??= (async () => {
      const { peer, init } = await connect(this.kind, this.opts.cwd);
      this.peer = peer;
      this.images = init.agentCapabilities?.promptCapabilities?.image === true;
      peer.onNotify = (method, p) => {
        if (method !== "session/update" || p.sessionId !== this.id) return;
        const u = p.update ?? {};
        if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") this.opts.onEvent({ type: "text", id: this.messageId, delta: u.content.text });
        if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "image" && u.content.data) this.opts.onEvent({ type: "image", id: this.messageId, image: { id: randomUUID(), name: `${ACP_INFO[this.kind].label} 圖片`, dataUrl: `data:${u.content.mimeType};base64,${u.content.data}` } });
        if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
          this.opts.onEvent({ type: "tool", id: u.toolCallId, name: u.title ?? "", summary: u.title ?? summarize("", u.rawInput), input: u.rawInput,
            status: u.status === "completed" ? "done" : u.status === "failed" ? "error" : "running", output: u.content ? truncate(u.content.map((b: Json) => b.content?.text ?? b.diff ?? "").join("\n")) : undefined });
        }
      };
      peer.onRequest = async (method, p) => {
        if (method !== "session/request_permission" || p.sessionId !== this.id) throw new Error("Unsupported client request");
        const decision = await this.opts.requestApproval({ name: p.toolCall?.title ?? "工具操作", summary: summarize("", p.toolCall?.rawInput) || p.toolCall?.title || "", input: p.toolCall?.rawInput });
        const kinds = decision === "deny" ? ["reject_once", "reject_always"] : decision === "allowSession" ? ["allow_always", "allow_once"] : ["allow_once"];
        const option = kinds.map((k) => p.options?.find((o: Json) => o.kind === k)).find(Boolean);
        return { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } };
      };
      peer.onClose = () => { this.starting = undefined; this.peer = undefined; if (!this.closing) this.opts.onEvent({ type: "exit" }); };
      const params = { cwd: this.opts.cwd, mcpServers: [{ name: "tandem", command: this.opts.mcp.command, args: this.opts.mcp.args, env: Object.entries(this.opts.mcp.env).map(([name, value]) => ({ name, value })) }] };
      try {
        if (this.id && !init.agentCapabilities?.loadSession) throw new Error("此 provider 不支援恢復對話；請開新對話，原紀錄仍保留");
        const session = await peer.request(this.id ? "session/load" : "session/new", { ...params, ...(this.id ? { sessionId: this.id } : {}) });
        this.id = session.sessionId ?? this.id;
        if (!this.id) throw new Error("ACP 沒有回傳 session id");
        this.opts.onEvent({ type: "session", agentSessionId: this.id });
        this.configs = session.configOptions ?? [];
        const currentModel = session.models?.currentModelId ?? this.configs.find((c) => c.category === "model" || c.id === "model")?.currentValue;
        if ((this.opts.model && !standardModel(this.opts.model)) || (!this.opts.model && (this.kind === "cursor" || (currentModel && !standardModel(currentModel))))) throw new Error("請先選擇未啟用 fast 的明確模型");
        if (this.opts.model) {
          const config = this.configs.find((c) => c.category === "model" || c.id === "model");
          await peer.request(config ? "session/set_config_option" : "session/set_model", { sessionId: this.id, ...(config ? { configId: config.id, value: this.opts.model } : { modelId: this.opts.model }) });
        }
        return peer;
      } catch (e) { peer.close(); this.starting = undefined; throw e; }
    })();
  }
  async send(text: string, images: ChatImage[] = []) {
    if (this.turn) throw new Error("上一個回合尚未結束");
    this.cancelled = false;
    const peer = await this.ready();
    if (this.cancelled || this.closing) return;
    if (images.length && !this.images) throw new Error("這個 provider 的 ACP 尚未提供圖片輸入；圖片與原訊息已保留在對話");
    this.messageId = randomUUID();
    const prompt: Json[] = [...(text ? [{ type: "text", text }] : []), ...images.map((image) => {
      const i = image.dataUrl.indexOf(",");
      return { type: "image", mimeType: image.dataUrl.slice(5, i - 7), data: image.dataUrl.slice(i + 1) };
    })];
    // ACP returns only at turn completion. Don't block the local HTTP request for the whole turn.
    this.turn = peer.request("session/prompt", { sessionId: this.id, prompt }, 24 * 60 * 60_000).then((result) => {
      this.turn = undefined;
      if (result.stopReason === "refusal") this.opts.onEvent({ type: "error", message: "Provider 拒絕了這則請求" });
      this.opts.onEvent({ type: "turnDone" });
    }, (e: Error) => {
      this.turn = undefined;
      if (!this.closing) { this.opts.onEvent({ type: "error", message: `${ACP_INFO[this.kind].label} 沒能完成回覆`, detail: e.message }); this.opts.onEvent({ type: "turnDone" }); }
    });
  }
  async interrupt() {
    this.cancelled = true;
    if (this.starting) await this.starting.catch(() => undefined);
    if (!this.peer || !this.id || !this.turn) return;
    const peer = this.peer;
    const turn = this.turn;
    peer.notify("session/cancel", { sessionId: this.id });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([turn, new Promise<void>((resolve) => { timer = setTimeout(() => { peer.close(); resolve(); }, 10_000); })]);
    clearTimeout(timer);
  }
  async close() { this.closing = true; (this.peer ?? await this.starting?.catch(() => undefined))?.close(); }
}
