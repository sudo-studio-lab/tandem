/**
 * Chatting with the user's own agent inside Tandem (spec 003). Shared by the local server and the UI.
 * Chats live only on this computer (FR-008); nothing here is ever written to the repo.
 */
import type { AgentKind } from "./app.ts";

export interface ModelChoice {
  /** Passed to the agent as-is; "" = the agent's own default. */
  id: string;
  label: string;
  isDefault?: boolean;
}

/** How the user signed in to an agent. Tandem never sees the credentials themselves (FR-005). */
export type AgentAuth = "subscription" | "apiKey" | "none" | "unknown";

export interface AgentStatus {
  agent: AgentKind;
  /** Shown in menus ("Claude", "Codex"); never used as the name of a Tandem feature (FR-011). */
  label: string;
  installed: boolean;
  version?: string;
  auth: AgentAuth;
  /** e.g. "max", "plus"; only when the agent reports it. */
  plan?: string;
  models: ModelChoice[];
  installUrl: string;
  /** Plain-language problem, e.g. could not read the login state. */
  note?: string;
}

export type ApprovalDecision = "allow" | "allowSession" | "deny";

export type ChatItem =
  | { kind: "user"; id: string; at: string; text: string }
  | { kind: "assistant"; id: string; at: string; text: string; streaming?: boolean }
  | {
      kind: "tool";
      id: string;
      at: string;
      name: string;
      /** One line for the card header, e.g. the command or file path. */
      summary: string;
      input?: unknown;
      status: "running" | "done" | "error";
      output?: string;
    }
  | {
      kind: "approval";
      id: string;
      at: string;
      name: string;
      summary: string;
      input?: unknown;
      state: "pending" | "allowed" | "denied";
      /** Set when it was decided automatically (allowed for the whole chat, or cancelled by stop). */
      note?: string;
    }
  | { kind: "notice"; id: string; at: string; text: string }
  | { kind: "error"; id: string; at: string; message: string; detail?: string };

export interface ChatSummary {
  id: string;
  projectId: string;
  agent: AgentKind;
  /** "" = the agent's default model. */
  model: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The agent's own conversation id (Claude session_id / Codex thread id), used to continue. */
  agentSessionId?: string;
  running: boolean;
  costUsd?: number;
}

export interface Chat extends ChatSummary {
  items: ChatItem[];
}

/** Payload of the `chat` server-sent event. */
export type ChatUpdate =
  | { chatId: string; type: "item"; item: ChatItem }
  | { chatId: string; type: "delta"; itemId: string; text: string }
  | { chatId: string; type: "summary"; chat: ChatSummary }
  | { chatId: string; type: "deleted" };

/** POST /api/agents/:kind/login result. */
export interface AgentLoginStart {
  /** Opened in the browser (the provider's own page). */
  url?: string;
  /** A terminal window was opened running the agent's own login. */
  terminal?: boolean;
  message: string;
}
