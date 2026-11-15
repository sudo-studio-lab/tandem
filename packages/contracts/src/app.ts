/**
 * 002-desktop contracts: the app-level (multi-project) API shared by the local server,
 * the web UI and the Electron shell. Types only — no runtime code, so the web bundle stays small.
 */
import type { BoardData, SyncState } from "./index.ts";

// ---------------------------------------------------------------------------
// Activity: derived from GitHub, never stored in the repo.
// ---------------------------------------------------------------------------
export type ActivityKind = "commit" | "pr_opened" | "pr_merged" | "comment";

export interface ActivityItem {
  kind: ActivityKind;
  /** GitHub login of the person who did it. */
  login: string;
  /** One line, e.g. the commit subject or PR title. */
  title: string;
  url: string;
  /** ISO timestamp. */
  time: string;
  /** Branch for commits, when known. */
  branch?: string;
  /** For grouped commits: how many commits this item stands for. */
  count?: number;
}

/** Board data in 002: 001's BoardData plus per-member activity. */
export interface ProjectBoard extends BoardData {
  projectId: string;
  /** login → newest-first activity of the last 7 days (at most 10 per member). */
  activity: Record<string, ActivityItem[]>;
  /** Default branch the records are written to. */
  defaultBranch: string;
  /** Writes waiting in the local outbox (not yet pushed). */
  pendingWrites: number;
}

// ---------------------------------------------------------------------------
// Projects and session
// ---------------------------------------------------------------------------
export interface ProjectRef {
  /** Stable local id: "<owner>/<name>" lower-cased. */
  id: string;
  owner: string;
  name: string;
  /** Absolute local folder. */
  path: string;
  /** False when the folder no longer exists or is not a Tandem project. */
  available: boolean;
  /** Unread attention count (things waiting on me, unseen notifications). */
  attention: number;
}

export interface AppSession {
  /** Null when signed out. */
  login: string | null;
  /** Where the GitHub token came from. */
  tokenSource: "env" | "keyring" | "gh" | null;
  projects: ProjectRef[];
  /** Project to show first (last opened, or the one the server was started in). */
  currentProjectId: string | null;
  /** Default folder new projects are cloned into, e.g. C:\Users\x\Tandem. */
  projectsDir: string;
  /** True when running inside the desktop app (enables tray/notification settings). */
  desktop: boolean;
  version: string;
}

// ---------------------------------------------------------------------------
// GitHub login: OAuth device flow driven by the server.
// ---------------------------------------------------------------------------
export interface DeviceLoginStart {
  /** Opaque id to poll with. */
  id: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the code expires. */
  expiresIn: number;
}

export type DeviceLoginState =
  | { state: "pending" }
  | { state: "done"; login: string }
  | { state: "expired" }
  | { state: "denied" }
  | { state: "error"; message: string };

// ---------------------------------------------------------------------------
// Starting / joining projects
// ---------------------------------------------------------------------------
export interface RepoChoice {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  /** True when the repo already has a tandem/ folder on its default branch (best effort). */
  isTandem?: boolean;
  pushedAt?: string;
  /** Already set up on this computer. */
  localProjectId?: string;
}

export interface OwnerChoice {
  login: string;
  kind: "user" | "org";
}

export interface Invitation {
  id: number;
  repo: { owner: string; name: string; fullName: string; private: boolean };
  inviter: string;
  createdAt: string;
  /** Matches a ?repo= hint from a join link, so the UI can put it first. */
  hinted?: boolean;
}

export type ProjectStep = "accept" | "clone" | "setup" | "push" | "done";

export interface ProjectProgress {
  /** Operation id returned by the start/new/accept endpoints. */
  opId: string;
  step: ProjectStep;
  message: string;
  /** Set when step === "done". */
  projectId?: string;
  /** Set when the operation failed; message explains in plain words. */
  error?: { code: string; message: string; detail?: string };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export type NotificationKind = "waiting" | "review" | "task";

export interface AppNotification {
  /** Stable id so the same thing is never notified twice, e.g. "waiting:discussion:12". */
  id: string;
  kind: NotificationKind;
  projectId: string;
  title: string;
  body: string;
  url: string;
  time: string;
}

export interface AppSettings {
  notifications: Record<NotificationKind, boolean>;
  /** Desktop only. */
  openAtLogin: boolean;
}

// ---------------------------------------------------------------------------
// Opening the user's agent
// ---------------------------------------------------------------------------
export type AgentKind = "claude" | "codex";

export interface AgentAvailability {
  agent: AgentKind;
  installed: boolean;
  installUrl: string;
}

// ---------------------------------------------------------------------------
// Server-sent events on GET /api/events
// ---------------------------------------------------------------------------
export type AppEvent =
  | { type: "session"; data: AppSession }
  | { type: "board"; data: ProjectBoard }
  | { type: "sync"; data: SyncState & { projectId: string } }
  | { type: "progress"; data: ProjectProgress }
  | { type: "notify"; data: AppNotification }
  | { type: "chat"; data: import("./agent.ts").ChatUpdate }
  | { type: "agents"; data: import("./agent.ts").AgentStatus[] }
  | { type: "ping"; data: "" };

/** First line the server prints on stdout when started with `tandem serve`. */
export interface ServeReadyLine {
  ready: true;
  port: number;
  url: string;
}
