/**
 * Codex adapter: `codex app-server`, JSON-RPC over stdio, one JSON object per line
 * with the "jsonrpc" field left out. Written from the docs; not yet run against a real Codex here
 * (plan: tested by @theroyatlas). Everything protocol-specific is in this file.
 */
import type { ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import type { AgentLoginStart, AgentStatus, ApprovalDecision, ChatImage, ModelChoice } from "@tandem/contracts";
import open from "open";
import pkg from "../../package.json" with { type: "json" };
import { agentEnv, killTree, onLines, openTerminal, resolveCommand, runCapture, spawnAgent } from "./proc.ts";
import { summarize, truncate, type AdapterEvent, type AgentAdapter, type AgentSession, type McpLaunch, type StartOptions } from "./types.ts";

type Json = Record<string, any>;

/**
 * TANDEM_AGENT_LOG=<file>: append every protocol line to that file (for the first real Codex runs,
 * plan step "Codex 由 @theroyatlas 實測"). Off by default; the file stays on that computer.
 */
function debugLog(dir: ">>" | "<<", msg: unknown) {
  const file = process.env.TANDEM_AGENT_LOG;
  if (!file) return;
  try {
    appendFileSync(file, `${new Date().toISOString()} ${dir} ${typeof msg === "string" ? msg : JSON.stringify(msg)}\n`);
  } catch {
    /* logging must never break the chat */
  }
}

/** Minimal JSON-RPC peer over a child's stdio. */
class Rpc {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  onNotify: (method: string, params: Json) => void = () => {};
  onRequest: (method: string, params: Json) => Promise<unknown> = async () => ({});
  onClose: (code: number | null, stderr: string) => void = () => {};
  stderr = "";

  constructor(readonly child: ChildProcess) {
    onLines(child.stdout!, (line) => this.onLine(line));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d: string) => (this.stderr = (this.stderr + d).slice(-4000)));
    child.on("close", (code) => {
      for (const p of this.pending.values()) p.reject(new Error(`Codex 結束了（${code}）${this.stderr ? `：${this.stderr.slice(-500)}` : ""}`));
      this.pending.clear();
      this.onClose(code, this.stderr);
    });
    child.on("error", (e) => {
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
    });
  }

  private write(msg: Json) {
    debugLog(">>", msg);
    if (this.child.stdin?.writable) this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  request<T = Json>(method: string, params: Json = {}, timeoutMs = 60_000): Promise<T> {
    const id = this.nextId++;
    // Register the waiter before writing: a fast reply must not arrive before we listen for it.
    const p = new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex 沒有回應 ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(t), resolve(v)),
        reject: (e) => (clearTimeout(t), reject(e)),
      });
    });
    this.write({ id, method, params });
    return p;
  }

  notify(method: string, params?: Json) {
    this.write(params ? { method, params } : { method });
  }

  private onLine(line: string) {
    debugLog("<<", line);
    let m: Json;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id !== undefined && m.method) {
      // Server → client request (approvals).
      this.onRequest(m.method, m.params ?? {}).then(
        (result) => this.write({ id: m.id, result }),
        (e: Error) => this.write({ id: m.id, error: { code: -32000, message: e.message } }),
      );
    } else if (m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message ?? "Codex 回報錯誤"));
      else p.resolve(m.result);
    } else if (m.method) {
      this.onNotify(m.method, m.params ?? {});
    }
  }
}

/** TOML literal string: single quotes, nothing escaped (cmd.exe and argv parsing leave them alone). */
const lit = (s: string) => `'${s.replace(/'/g, "")}'`;

/** `-c` overrides that add Tandem's MCP server for this run only, without touching ~/.codex (B7). */
function mcpOverrides(mcp: McpLaunch): string[] {
  const env = Object.entries(mcp.env).map(([k, v]) => `${k}=${lit(v)}`).join(",");
  return [
    "-c", `mcp_servers.tandem.command=${lit(mcp.command)}`,
    "-c", `mcp_servers.tandem.args=[${mcp.args.map(lit).join(",")}]`,
    ...(env ? ["-c", `mcp_servers.tandem.env={${env}}`] : []),
  ];
}

async function startRpc(cwd: string, extraArgs: string[] = [], experimental = false): Promise<Rpc> {
  const child = spawnAgent("codex", [...extraArgs, "app-server"], { cwd, env: agentEnv() });
  const rpc = new Rpc(child);
  try {
    await rpc.request("initialize", { clientInfo: { name: "tandem", title: "Tandem", version: pkg.version }, ...(experimental ? { capabilities: { experimentalApi: true } } : {}) }, 30_000);
    rpc.notify("initialized");
  } catch (e) { killTree(child); throw e; }
  return rpc;
}

let loginRpc: Rpc | null = null;

export const codexAdapter: AgentAdapter = {
  kind: "codex",

  async status(): Promise<AgentStatus> {
    const base: AgentStatus = {
      agent: "codex",
      label: "Codex",
      installed: false,
      auth: "none",
      models: [{ id: "", label: "預設", isDefault: true }],
      installUrl: "https://developers.openai.com/codex",
      supportsSteer: true,
      supportsImages: true,
    };
    if (!resolveCommand("codex")) return base;
    const ver = await runCapture("codex", ["--version"]);
    const out: AgentStatus = { ...base, installed: true, version: /\d+\.\d+\.\d+/.exec(ver.stdout)?.[0] };
    let rpc: Rpc | null = null;
    try {
      rpc = await startRpc(process.cwd());
      const acct = await rpc.request<{ account: { type: string; planType?: string } | null }>("account/read", { refreshToken: false });
      const models: Json[] = [];
      let cursor: string | undefined;
      do {
        const page = await rpc.request<{ data: Json[]; nextCursor?: string | null }>("model/list", { ...(cursor ? { cursor } : {}), includeHidden: false });
        models.push(...(page.data ?? []));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      const choices: ModelChoice[] = [
        { id: "", label: "預設", isDefault: true },
        ...models.filter((m) => !m.hidden).map((m) => ({
          id: m.model ?? m.id ?? "", label: m.displayName ?? m.model ?? m.id ?? "",
          reasoningEfforts: m.supportedReasoningEfforts?.map((e: Json) => e.reasoningEffort),
          inputModalities: m.inputModalities,
        })).filter((m) => m.id),
      ];
      const a = acct.account;
      return {
        ...out,
        auth: !a ? "none" : a.type === "chatgpt" ? "subscription" : a.type === "apiKey" ? "apiKey" : "unknown",
        plan: a?.planType,
        models: choices,
      };
    } catch (e) {
      return { ...out, auth: "unknown", note: `讀不到 Codex 的登入狀態：${(e as Error).message}` };
    } finally {
      if (rpc) killTree(rpc.child);
    }
  },

  async login(method, cwd): Promise<AgentLoginStart> {
    if (method === "apiKey") {
      // Codex's own API key login, in a terminal: the key goes to Codex, never through Tandem (B4).
      openTerminal(cwd, ["codex", "login", "--with-api-key"]);
      return { terminal: true, message: "已經打開終端機。把你的 OpenAI API key 貼進去，按 Enter，再按 Ctrl+Z、Enter 結束。完成後回到這裡。" };
    }
    if (loginRpc) killTree(loginRpc.child);
    const rpc = await startRpc(cwd);
    loginRpc = rpc;
    const r = await rpc.request<{ authUrl: string }>("account/login/start", { type: "chatgpt" });
    // Keep app-server alive until OpenAI's page calls back, then let it go.
    const done = () => {
      if (loginRpc === rpc) loginRpc = null;
      killTree(rpc.child);
    };
    rpc.onNotify = (method) => {
      if (method === "account/login/completed") setTimeout(done, 1000);
    };
    setTimeout(done, 10 * 60_000);
    await open(r.authUrl).catch(() => undefined);
    return { url: r.authUrl, message: "已經在瀏覽器打開 OpenAI 的登入頁。登入後回到這裡。" };
  },

  async logout(): Promise<void> {
    const rpc = await startRpc(process.cwd());
    try {
      await rpc.request("account/logout", {});
    } finally {
      killTree(rpc.child);
    }
  },

  start(opts: StartOptions): AgentSession {
    return new CodexSession(opts);
  },
};

const DECISION: Record<ApprovalDecision, string> = { allow: "accept", allowSession: "acceptForSession", deny: "decline" };

class CodexSession implements AgentSession {
  private rpc: Promise<Rpc> | null = null;
  private threadId: string | undefined;
  private turnId: string | undefined;
  private items = new Map<string, Json>();
  private completion?: { promise: Promise<void>; resolve(): void; done: boolean };
  private closing = false;

  constructor(private opts: StartOptions) {
    this.threadId = opts.answerOnly ? undefined : opts.resumeId;
  }

  private emit(e: AdapterEvent) {
    this.opts.onEvent(e);
  }

  private connect(): Promise<Rpc> {
    if (this.rpc) return this.rpc;
    this.closing = false;
    const p = (async () => {
      const restricted = this.opts.answerOnly;
      const answeringArgs = [
        ...(restricted ? ["-c", "mcp_servers={}", "-c", "features.shell_tool=false", "-c", "features.apps=false", "-c", "features.plugins=false", "-c", "features.hooks=false", "-c", "features.multi_agent=false", "-c", 'web_search="disabled"', "-c", "disable_user_hooks=true", "-c", "project_doc_max_bytes=0", "-c", "memories.use_memories=false", "-c", "memories.generate_memories=false"] : []),
        ...mcpOverrides(this.opts.mcp),
      ];
      let rpc = await startRpc(this.opts.cwd, answeringArgs, !!restricted);
      if(restricted){
        const first=await rpc.request<{config:Json}>("config/read",{includeLayers:false});
        if(!first.config?.mcp_servers){killTree(rpc.child);throw new Error("無法確認 MCP 隔離設定");}
        const inherited=Object.keys(first.config.mcp_servers).filter(k=>k!=="tandem"&&first.config.mcp_servers[k]?.enabled!==false);
        if(inherited.length){
          killTree(rpc.child);
          if(inherited.some(k=>!/^[A-Za-z0-9_-]+$/.test(k)))throw new Error("無法安全覆寫這個 MCP 設定名稱，回答模式已停止");
          const disabled=inherited.flatMap(k=>["-c",`mcp_servers.${k}.enabled=false`]);
          rpc=await startRpc(this.opts.cwd,[...answeringArgs,...disabled],true);
        }
      }
      if (this.closing) { killTree(rpc.child); throw new Error("已停止"); }
      rpc.onNotify = (m, params) => this.onNotify(m, params);
      rpc.onRequest = (m, params) => this.onRequest(m, params);
      rpc.onClose = (code, stderr) => {
        if (this.rpc === p) this.rpc = null;
        if (this.turnId && !this.closing) this.emit({ type: "error", message: "Codex 意外結束了", detail: `exit ${code}\n${stderr}`.trim() });
        this.turnId = undefined;
        this.completion?.resolve();
        this.emit({ type: "exit" });
      };
      if (restricted) {
        // Fail closed if a CLI version ignores the isolation overrides; never inherit other MCP servers.
        const effective = await rpc.request<{ config: Json }>("config/read", { includeLayers: false });
        const cfg = effective.config;
        if (!cfg || cfg.features?.shell_tool !== false || cfg.features?.apps !== false || cfg.features?.plugins !== false || cfg.features?.hooks !== false || cfg.features?.multi_agent !== false || cfg.web_search !== "disabled" || !cfg.mcp_servers || Object.keys(cfg.mcp_servers).some(k=>k!=="tandem"&&cfg.mcp_servers[k]?.enabled!==false)) {
          killTree(rpc.child);
          throw new Error("這個 Codex 版本無法確認回答模式的工具限制，已停止");
        }
      }
      const params: Json = { cwd: this.opts.cwd, ...(this.opts.model ? { model: this.opts.model } : {}),
        ...(restricted ? { approvalPolicy: "never", sandbox: "read-only", ephemeral: true, environments: [], selectedCapabilityRoots: [], baseInstructions: restricted.instructions, serviceTier: "default" } : {}) };
      const r = this.threadId
        ? await rpc.request<{ thread: { id: string } }>("thread/resume", { threadId: this.threadId, ...params })
        : await rpc.request<{ thread: { id: string } }>("thread/start", params);
      if (r.thread?.id && r.thread.id !== this.threadId) {
        this.threadId = r.thread.id;
        this.emit({ type: "session", agentSessionId: r.thread.id });
      }
      return rpc;
    })();
    this.rpc = p;
    p.catch(() => {
      if (this.rpc === p) this.rpc = null;
    });
    return p;
  }

  private itemEvent(item: Json, done: boolean) {
    const status = done ? (item.status === "failed" || item.status === "declined" || (item.exitCode ?? 0) !== 0 ? "error" : "done") : "running";
    switch (item.type) {
      case "agentMessage":
        if (done) this.emit({ type: "message", id: item.id, text: item.text ?? "" });
        return;
      case "commandExecution":
        this.emit({ type: "tool", id: item.id, name: "指令", summary: summarize("", { command: item.command }), input: { command: item.command, cwd: item.cwd }, status, output: done ? truncate(item.aggregatedOutput ?? "") : undefined });
        return;
      case "fileChange": {
        const paths = (item.changes ?? []).map((c: Json) => c.path).join("、");
        this.emit({ type: "tool", id: item.id, name: "改檔案", summary: paths, input: item.changes, status, output: done ? truncate((item.changes ?? []).map((c: Json) => c.diff ?? "").join("\n")) : undefined });
        return;
      }
      case "mcpToolCall":
        this.emit({ type: "tool", id: item.id, name: `${item.server}.${item.tool}`, summary: summarize(item.tool, item.arguments), input: item.arguments, status, output: done ? truncate(JSON.stringify(item.result ?? item.error ?? "")) : undefined });
        return;
      case "webSearch":
        this.emit({ type: "tool", id: item.id, name: "搜尋", summary: item.query ?? "", status });
        return;
    }
  }

  private onNotify(method: string, p: Json) {
    switch (method) {
      case "turn/started":
        this.turnId = p.turn?.id ?? this.turnId;
        return;
      case "item/agentMessage/delta":
        this.emit({ type: "text", id: p.itemId, delta: p.delta ?? "" });
        return;
      case "item/started":
        if (p.item?.id) this.items.set(p.item.id, p.item);
        this.itemEvent(p.item ?? {}, false);
        return;
      case "item/completed":
        this.itemEvent(p.item ?? {}, true);
        return;
      case "turn/completed": {
        this.turnId = undefined;
        this.completion?.resolve();
        const t = p.turn ?? {};
        if (t.status === "failed") this.emit({ type: "error", message: plainError(t.error?.message ?? ""), detail: JSON.stringify(t.error ?? {}) });
        this.emit({ type: "turnDone" });
        return;
      }
      case "error":
        if (!p.willRetry) this.emit({ type: "error", message: plainError(p.error?.message ?? ""), detail: JSON.stringify(p) });
        return;
    }
  }

  private async onRequest(method: string, p: Json): Promise<unknown> {
    if (this.opts.answerOnly) return { decision: "decline" };
    if (method === "item/commandExecution/requestApproval") {
      const d = await this.opts.requestApproval({ name: "執行指令", summary: summarize("", { command: p.command }) || p.reason || "", input: { command: p.command, cwd: p.cwd, reason: p.reason } });
      return { decision: DECISION[d] };
    }
    if (method === "item/fileChange/requestApproval") {
      const item = this.items.get(p.itemId) ?? {};
      const paths = (item.changes ?? []).map((c: Json) => c.path).join("、");
      const d = await this.opts.requestApproval({ name: "改檔案", summary: paths || p.reason || "", input: { changes: item.changes, reason: p.reason } });
      return { decision: DECISION[d] };
    }
    // Anything we don't know yet: say no rather than guess (Roy's test run will tell us what shows up).
    return { decision: "decline" };
  }

  async send(text: string, images: ChatImage[] = []): Promise<void> {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    const completion = { promise, done: false, resolve() { this.done = true; resolve(); } };
    this.completion = completion;
    try {
      const rpc = await this.connect();
      if (this.closing) { completion.resolve(); return; }
      const r = await rpc.request<{ turn?: { id: string } }>("turn/start", {
        threadId: this.threadId,
        input: [...(text ? [{ type: "text", text }] : []), ...images.map((image) => ({ type: "image", url: image.dataUrl }))],
        ...(this.opts.reasoningEffort ? { effort: this.opts.reasoningEffort } : {}),
      });
      if (!completion.done) this.turnId = r.turn?.id ?? this.turnId;
    } catch (e) {
      if (!this.closing) this.emit({ type: "error", message: "沒辦法把訊息交給 Codex", detail: (e as Error).message });
      this.emit({ type: "turnDone" });
      completion.resolve();
    }
  }

  async interrupt(): Promise<void> {
    const p = this.rpc;
    if (!p) return;
    if (!this.turnId) {
      this.closing = true;
      const peer = await p.catch(() => undefined);
      if (peer) killTree(peer.child);
      this.rpc = null;
      this.completion?.resolve();
      return;
    }
    const rpc = await p;
    await rpc.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId }, 10_000).catch(() => {
      this.closing = true;
      killTree(rpc.child);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (this.completion) await Promise.race([this.completion.promise, new Promise<void>((resolve) => { timer = setTimeout(() => { this.closing = true; killTree(rpc.child); resolve(); }, 10_000); })]);
    clearTimeout(timer);
  }

  async steer(text: string, images: ChatImage[] = []): Promise<void> {
    if (!this.turnId || !this.rpc) throw new Error("目前沒有可補充的工作，請直接送出或排入下一則");
    const turnId = this.turnId;
    const rpc = await this.rpc;
    await rpc.request("turn/steer", {
      threadId: this.threadId, expectedTurnId: turnId,
      input: [...(text ? [{ type: "text", text }] : []), ...images.map((image) => ({ type: "image", url: image.dataUrl }))],
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    const p = this.rpc;
    this.rpc = null;
    if (p) killTree((await p.catch(() => null))?.child ?? ({ exitCode: 0 } as ChildProcess));
  }
}

function plainError(raw: string): string {
  if (/usage limit|rate limit|quota/i.test(raw)) return `Codex 的額度用完了，請稍後再試。（${raw.slice(0, 120)}）`;
  if (/not logged in|login|unauthorized|401/i.test(raw)) return "Codex 還沒登入，或登入已經過期。請到「AI 設定」重新登入。";
  return raw ? `Codex 回報錯誤：${raw.slice(0, 300)}` : "Codex 回報錯誤";
}
