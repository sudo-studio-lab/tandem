/**
 * Claude adapter.
 * Runs the user's own, unmodified `claude` in print mode with stream-json in and out. One process
 * per chat stays alive between messages; stopping kills it and the next message resumes with
 * `--resume <session_id>`. Approvals go through `tandem mcp`'s approve tool.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AgentLoginStart, AgentStatus, ChatImage, ModelChoice } from "@tandem/contracts";
import { appStateDir } from "@tandem/core";
import { agentEnv, killTree, onLines, openTerminal, resolveCommand, runCapture, spawnAgent } from "./proc.ts";
import { summarize, truncate, type AdapterEvent, type AgentAdapter, type AgentSession, type StartOptions } from "./types.ts";

const MODELS: ModelChoice[] = [
  { id: "", label: "預設", isDefault: true },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];

/** Team tools that run without asking: reading, and records the user already confirmed in chat. */
const AUTO_ALLOWED = ["tandem_brief", "tandem_decisions", "tandem_check", "tandem_decide", "tandem_status"].map(
  (t) => `mcp__tandem__${t}`,
);

export const claudeAdapter: AgentAdapter = {
  kind: "claude",

  async status(): Promise<AgentStatus> {
    const base: AgentStatus = {
      agent: "claude",
      label: "Claude",
      installed: false,
      auth: "none",
      models: MODELS,
      installUrl: "https://code.claude.com/docs/en/setup",
      supportsSteer: false,
      supportsImages: true,
    };
    if (!resolveCommand("claude")) return base;
    const [ver, st] = await Promise.all([runCapture("claude", ["--version"]), runCapture("claude", ["auth", "status", "--json"])]);
    const version = /\d+\.\d+\.\d+/.exec(ver.stdout)?.[0];
    const out: AgentStatus = { ...base, installed: true, version };
    if (process.env.ANTHROPIC_API_KEY) return { ...out, auth: "apiKey" };
    try {
      // Only these fields are read; email and org are never shown or stored.
      const j = JSON.parse(st.stdout) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
      if (!j.loggedIn) return { ...out, auth: "none" };
      const subscription = j.authMethod === "claude.ai" || !!j.subscriptionType;
      return { ...out, auth: subscription ? "subscription" : "apiKey", plan: j.subscriptionType || undefined };
    } catch {
      return { ...out, auth: "unknown", note: "讀不到登入狀態" };
    }
  },

  async login(method, cwd): Promise<AgentLoginStart> {
    // Claude Code's own login flow, in a real terminal. Tandem never sees the result.
    openTerminal(cwd, method === "apiKey" ? ["claude", "auth", "login", "--console"] : ["claude", "auth", "login"]);
    return {
      terminal: true,
      message:
        method === "apiKey"
          ? "已經打開終端機，照 Claude 的步驟登入 Console 帳號（用 API 計費）。完成後回到這裡。"
          : "已經打開終端機，照 Claude 的步驟用你的 Claude 帳號登入。完成後回到這裡。",
    };
  },

  async logout(): Promise<void> {
    await runCapture("claude", ["auth", "logout"]);
  },

  start(opts: StartOptions): AgentSession {
    return new ClaudeSession(opts);
  },
};

class ClaudeSession implements AgentSession {
  private child: ChildProcess | null = null;
  private sessionId: string | undefined;
  private stopping = false;
  private stderr = "";
  private configFile: string;
  /** message id → text blocks seen so far, so streamed and final text share an item id. */
  private turnActive = false;

  constructor(private opts: StartOptions) {
    this.sessionId = opts.resumeId;
    this.configFile = path.join(appStateDir(), "chats", `${opts.chatId}.mcp.json`);
  }

  private emit(e: AdapterEvent) {
    this.opts.onEvent(e);
  }

  private async ensureProcess(): Promise<ChildProcess> {
    if (this.child && this.child.exitCode === null && !this.stopping) return this.child;
    const { opts } = this;
    // The MCP config holds the approve token, so it goes in a file under the user's app folder, not argv.
    const env = { ...opts.mcp.env, ...(opts.approveBridge ? { TANDEM_APPROVE_URL: opts.approveBridge.url, TANDEM_APPROVE_TOKEN: opts.approveBridge.token, TANDEM_CHAT_ID: opts.chatId } : {}) };
    await mkdir(path.dirname(this.configFile), { recursive: true });
    await writeFile(this.configFile, JSON.stringify({ mcpServers: { tandem: { command: opts.mcp.command, args: opts.mcp.args, env } } }), "utf8");

    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--mcp-config", this.configFile,
      "--allowedTools", AUTO_ALLOWED.join(","),
    ];
    if (opts.approveBridge) args.push("--permission-prompt-tool", "mcp__tandem__approve");
    if (opts.model) args.push("--model", opts.model);
    if (this.sessionId) args.push("--resume", this.sessionId);

    this.stopping = false;
    this.stderr = "";
    const child = spawnAgent("claude", args, { cwd: opts.cwd, env: agentEnv() });
    this.child = child;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d: string) => (this.stderr = (this.stderr + d).slice(-4000)));
    onLines(child.stdout!, (line) => this.onLine(line));
    child.on("error", (e) => this.emit({ type: "error", message: "沒辦法啟動 Claude", detail: e.message }));
    child.on("close", (code) => {
      if (this.child !== child) return;
      this.child = null;
      // The config holds the approve token; it is rewritten on the next start.
      void rm(this.configFile, { force: true }).catch(() => undefined);
      if (!this.stopping && this.turnActive) {
        this.emit({ type: "error", message: "Claude 意外結束了", detail: `exit ${code}\n${this.stderr}`.trim() });
      }
      this.turnActive = false;
      this.emit({ type: "exit" });
    });
    return child;
  }

  private onLine(line: string) {
    let j: any;
    try {
      j = JSON.parse(line);
    } catch {
      return;
    }
    if (j.session_id && j.session_id !== this.sessionId) {
      this.sessionId = j.session_id;
      this.emit({ type: "session", agentSessionId: j.session_id });
    }
    switch (j.type) {
      case "stream_event": {
        const ev = j.event;
        // Text blocks are numbered in order within a message ("t0", "t1"…): the streamed block index
        // and the block's position in the later `assistant` events don't line up.
        if (ev?.type === "message_start") this.msgId = ev.message?.id ?? this.msgId;
        if (ev?.type === "content_block_start" && ev.content_block?.type === "text") {
          const n = this.streamTextCount.get(this.msgId) ?? 0;
          this.streamTextCount.set(this.msgId, n + 1);
          this.streamBlock.set(`${this.msgId}:${ev.index}`, `${this.msgId}:t${n}`);
        }
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          const id = this.streamBlock.get(`${this.msgId}:${ev.index}`) ?? `${this.msgId}:i${ev.index}`;
          this.emit({ type: "text", id, delta: ev.delta.text });
        }
        return;
      }
      case "assistant": {
        const msg = j.message;
        for (const b of msg?.content ?? []) {
          if (b.type === "text") {
            const n = this.finalTextCount.get(msg.id) ?? 0;
            this.finalTextCount.set(msg.id, n + 1);
            this.emit({ type: "message", id: `${msg.id}:t${n}`, text: b.text });
          } else if (b.type === "image" && b.source?.type === "base64") {
            this.emit({ type: "image", id: `${msg.id}:image`, image: { id: randomUUID(), name: "Claude 圖片", dataUrl: `data:${b.source.media_type};base64,${b.source.data}` } });
          } else if (b.type === "tool_use") {
            this.emit({ type: "tool", id: b.id, name: b.name, summary: summarize(b.name, b.input), input: b.input, status: "running" });
          }
        }
        return;
      }
      case "user": {
        for (const b of j.message?.content ?? []) {
          if (b.type !== "tool_result") continue;
          const text = typeof b.content === "string" ? b.content : (b.content ?? []).map((c: any) => c.text ?? "").join("\n");
          this.emit({ type: "tool", id: b.tool_use_id, name: "", summary: "", status: b.is_error ? "error" : "done", output: truncate(text) });
        }
        return;
      }
      case "result": {
        this.turnActive = false;
        if (j.is_error || (j.subtype && j.subtype !== "success")) {
          this.emit({ type: "error", message: plainError(String(j.result ?? j.subtype ?? "")), detail: JSON.stringify(j.errors ?? j.result ?? j.subtype) });
        }
        this.emit({ type: "turnDone", costUsd: typeof j.total_cost_usd === "number" ? j.total_cost_usd : undefined });
        return;
      }
    }
  }
  private msgId = "m";
  private streamTextCount = new Map<string, number>();
  private streamBlock = new Map<string, string>();
  private finalTextCount = new Map<string, number>();

  async send(text: string, images: ChatImage[] = []): Promise<void> {
    const child = await this.ensureProcess();
    this.turnActive = true;
    const content = images.length ? [
      ...(text ? [{ type: "text", text }] : []),
      ...images.map((image) => {
        const [header, data] = image.dataUrl.split(",");
        return { type: "image", source: { type: "base64", media_type: header!.slice(5, -7), data } };
      }),
    ] : text;
    child.stdin!.write(`${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`);
  }

  async interrupt(): Promise<void> {
    if (!this.child) return;
    this.stopping = true;
    killTree(this.child);
  }

  async close(): Promise<void> {
    await this.interrupt();
    await rm(this.configFile, { force: true }).catch(() => undefined);
  }
}

/** Plain words for the errors people actually hit; the raw text stays in `detail`. */
function plainError(raw: string): string {
  if (/usage limit|rate limit|limit reached|hit your limit/i.test(raw)) return `Claude 的額度用完了，請稍後再試。（${raw.slice(0, 120)}）`;
  if (/not logged in|login|authenticat|invalid api key/i.test(raw)) return "Claude 還沒登入，或登入已經過期。請到「AI 設定」重新登入。";
  if (/overloaded/i.test(raw)) return "Claude 現在太忙，請稍後再試。";
  return raw ? `Claude 回報錯誤：${raw.slice(0, 300)}` : "Claude 回報錯誤";
}
