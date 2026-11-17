/**
 * The one interface both agents are driven through (plan "統一的轉接介面"). The chat manager only
 * sees these events, so Claude and Codex look the same to the rest of Tandem.
 */
import type { AgentKind, AgentLoginStart, AgentStatus, ApprovalDecision, ChatImage } from "@tandem/contracts";

export type AdapterEvent =
  | { type: "session"; agentSessionId: string }
  /** Streaming text for one assistant message; `id` is stable per message. */
  | { type: "text"; id: string; delta: string }
  /** Final text for a message (replaces whatever was streamed). */
  | { type: "message"; id: string; text: string }
  | { type: "image"; id: string; image: ChatImage }
  | { type: "tool"; id: string; name: string; summary: string; input?: unknown; status: "running" | "done" | "error"; output?: string }
  | { type: "turnDone"; costUsd?: number }
  | { type: "error"; message: string; detail?: string }
  /** The agent process went away (stopped, crashed, or finished). */
  | { type: "exit" };

export interface ApprovalRequest {
  /** Tool or action name as the agent calls it ("Bash", "Write", "commandExecution"…). */
  name: string;
  summary: string;
  input?: unknown;
}

/** How to start `tandem mcp` from inside the agent. */
export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface StartOptions {
  chatId: string;
  cwd: string;
  /** "" = agent default. */
  model: string;
  reasoningEffort?: string;
  /** Continue this conversation (Claude session_id / Codex thread id). */
  resumeId?: string;
  mcp: McpLaunch;
  /** Claude only: where `tandem mcp`'s approve tool posts to. */
  approveBridge?: { url: string; token: string };
  /** Codex only: approvals arrive in-protocol and are answered through this. */
  requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
  onEvent(e: AdapterEvent): void;
}

export interface AgentSession {
  send(text: string, images?: ChatImage[]): Promise<void>;
  steer?(text: string, images?: ChatImage[]): Promise<void>;
  /** Stop the current turn. The conversation can continue with the next send(). */
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface AgentAdapter {
  kind: AgentKind;
  status(): Promise<AgentStatus>;
  login(method: "subscription" | "apiKey", cwd: string): Promise<AgentLoginStart>;
  logout(): Promise<void>;
  start(opts: StartOptions): AgentSession;
}

/** Short, single-line description of a tool call for card headers. */
export function summarize(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof i[k] === "string" && i[k]) return i[k] as string;
    return "";
  };
  const s = pick("command", "file_path", "path", "notebook_path", "pattern", "url", "query", "description", "title");
  const one = (s || (input === undefined ? "" : JSON.stringify(input))).replace(/\s+/g, " ").trim();
  return one.length > 140 ? `${one.slice(0, 139)}…` : one;
}

export function truncate(text: string, max = 8000): string {
  return text.length > max ? `${text.slice(0, max)}\n…（後面省略 ${text.length - max} 字）` : text;
}
