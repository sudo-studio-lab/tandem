/**
 * Chatting with the user's own agent inside Tandem. Shared by the local server and the UI.
 * Chats live only on this computer; nothing here is ever written to the repo.
 */
import type { AgentKind } from "./app.ts";

export interface ModelChoice {
  /** Passed to the agent as-is; "" = the agent's own default. */
  id: string;
  label: string;
  isDefault?: boolean;
  reasoningEfforts?: string[];
  inputModalities?: string[];
}

export interface ChatImage {
  id: string;
  name: string;
  /** Local image bytes; never uploaded to GitHub. */
  dataUrl: string;
}

/** How the user signed in to an agent. Tandem never sees the credentials themselves. */
export type AgentAuth = "subscription" | "apiKey" | "authenticated" | "none" | "unknown";

export interface AgentStatus {
  agent: AgentKind;
  /** Shown in menus ("Claude", "Codex"); never used as the name of a Tandem feature. */
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
  managedAuthExternally?: boolean;
  supportsSteer?: boolean;
  supportsImages?: boolean;
  terminalAvailable?: boolean;
}

export interface QueuedMessage {
  id: string;
  text: string;
  images: ChatImage[];
  at: string;
}

export type ApprovalDecision = "allow" | "allowSession" | "deny";

export type ChatItem =
  /** `by`/`url` are set in rooms: who said it, and the GitHub comment it came from. */
  | { kind: "user"; id: string; at: string; text: string; images?: ChatImage[]; by?: string; url?: string }
  | { kind: "assistant"; id: string; at: string; text: string; images?: ChatImage[]; streaming?: boolean }
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
  reasoningEffort?: string;
  queue?: QueuedMessage[];
  queuePaused?: boolean;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The agent's own conversation id (Claude session_id / Codex thread id), used to continue. */
  agentSessionId?: string;
  running: boolean;
  costUsd?: number;
  /** Set when this chat is the host side of a room: the agent answers the whole room. */
  room?: { number: number; url: string };
}

export interface Chat extends ChatSummary {
  items: ChatItem[];
  /** External snapshot for a new provider session, without the source resume id. */
  forkContext?: string;
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

/**
 * A room: several teammates talk with one agent that runs on the host's computer.
 * Messages travel through a GitHub Discussion, so every line has an author and a URL.
 */
export interface RoomRef {
  number: number;
  url: string;
  title: string;
  /** GitHub login whose computer (and agent subscription) runs the AI. */
  host: string;
  closed: boolean;
  updatedAt: string;
}

export interface RoomMessage {
  id: string;
  by: string;
  text: string;
  url: string;
  at: string;
  /** Written by the room's AI (posted by the host's app, starts with 🤖). */
  ai: boolean;
}

export interface Room extends RoomRef {
  /** Meeting notes kept by the AI (the discussion body below the marker). */
  notes: string;
  messages: RoomMessage[];
  /** The host's local chat behind this room; only set on the host's computer. */
  chatId?: string;
  /** Host side: the AI is answering right now. */
  running?: boolean;
}
