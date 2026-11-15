/**
 * Tandem shared contracts: data formats only, no I/O.
 * Spec: specs/001-core/data-model.md and contracts/cli.md.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Product naming. Every user-visible name derives from here so that renaming
// the product (Q-20261115-1c9) is a one-line change.
// ---------------------------------------------------------------------------
export const PRODUCT = {
  /** CLI command name. */
  command: "tandem",
  displayName: "Tandem",
  /** Data folder inside a user's repo. */
  dataDir: "tandem",
  /** Folder under .git/ for per-clone local state. */
  localStateDir: "tandem",
  /** Prefix for GitHub labels. */
  labelPrefix: "tandem:",
  /** Name used in managed-block markers: <!-- BEGIN TANDEM ... --> */
  markerName: "TANDEM",
  /** Prefix for agent skill folders. */
  skillPrefix: "tandem-",
} as const;

export const LABELS = {
  question: `${PRODUCT.labelPrefix}question`,
  disagreement: `${PRODUCT.labelPrefix}disagreement`,
  task: `${PRODUCT.labelPrefix}task`,
} as const;

/** Paths relative to the repo root. */
export const PATHS = {
  decisions: `${PRODUCT.dataDir}/decisions`,
  status: `${PRODUCT.dataDir}/status`,
  team: `${PRODUCT.dataDir}/team.md`,
} as const;

/** Section headings used in decision bodies (kept here for future i18n). */
export const DECISION_SECTIONS = {
  quotes: "原話",
  decision: "決定",
  why: "原因",
  optionsConsidered: "考慮過的其他做法",
  scope: "適用範圍與什麼時候該重新檢視",
} as const;

/** First line of a discussion body that names who it is waiting on. */
export const WAITING_PREFIX = "等：";

// ---------------------------------------------------------------------------
// IDs: <kind>-<YYYYMMDD>-<4 base36>, e.g. D-20261115-k3f9 (research R1)
// ---------------------------------------------------------------------------
export const DECISION_ID_RE = /^D-(\d{8})-([0-9a-z]{4})$/;
export const DecisionId = z.string().regex(DECISION_ID_RE, "編號格式應為 D-YYYYMMDD-xxxx（4 碼小寫英數）");
export type DecisionId = z.infer<typeof DecisionId>;

export const GitHubLogin = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "GitHub 帳號格式不正確");
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式應為 YYYY-MM-DD");
/** Where something was said or decided: "chat" (the user's own agent conversation) or a URL. */
export const Source = z.union([z.literal("chat"), z.url()]);
export type Source = z.infer<typeof Source>;

export const Strength = z.enum(["hard", "preference", "hunch", "one-off"]);
export type Strength = z.infer<typeof Strength>;

// ---------------------------------------------------------------------------
// Decisions (immutable once written; "superseded" is derived on read — R2)
// ---------------------------------------------------------------------------
export const DecisionFrontmatter = z.object({
  id: DecisionId,
  title: z.string().min(1),
  date: IsoDate,
  deciders: z.array(GitHubLogin).min(1),
  consulted: z.array(GitHubLogin).default([]),
  area: z.string().optional(),
  strength: Strength,
  source: Source,
  supersedes: z.array(DecisionId).default([]),
});
export type DecisionFrontmatter = z.infer<typeof DecisionFrontmatter>;

export const Quote = z.object({
  /** GitHub login of the person who said it. */
  by: GitHubLogin,
  /** Verbatim words. Never paraphrased, summarized or translated. */
  text: z.string().min(1),
  /** "chat" or a URL to where it was said. Quoting someone other than the deciders requires a URL unless relayedBy is set. */
  source: Source,
  /** If someone relayed these words (no first-hand source), their login. Marks the quote as 轉述. */
  relayedBy: GitHubLogin.optional(),
});
export type Quote = z.infer<typeof Quote>;

/** Input for `tandem decide` (--input JSON). */
export const DecisionInput = z.object({
  title: z.string().min(1),
  /** English slug for the filename, e.g. "local-web-first". Generated from title if omitted and title is ASCII. */
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  deciders: z.array(GitHubLogin).min(1),
  consulted: z.array(GitHubLogin).default([]),
  area: z.string().optional(),
  strength: Strength,
  source: Source,
  /** Verbatim quotes. If empty, noQuoteBy must be set. */
  quotes: z.array(Quote).default([]),
  /** When there are no original words: the login whose agent wrote this record. */
  noQuoteBy: GitHubLogin.optional(),
  decision: z.string().min(1),
  why: z.string().min(1),
  optionsConsidered: z.string().optional(),
  scope: z.string().optional(),
  supersedes: z.array(DecisionId).default([]),
  /** Defaults to today. */
  date: IsoDate.optional(),
});
export type DecisionInput = z.input<typeof DecisionInput>;
export type DecisionInputParsed = z.output<typeof DecisionInput>;

/** A decision as read from disk. */
export interface Decision {
  frontmatter: DecisionFrontmatter;
  /** Repo-relative path with forward slashes. */
  path: string;
  quotes: Quote[];
  /** Set when the record says it has no original words. */
  noQuoteBy?: string;
  decision: string;
  why: string;
  optionsConsidered?: string;
  scope?: string;
  /** Derived: ids of decisions whose `supersedes` contains this id. */
  supersededBy: string[];
}

// ---------------------------------------------------------------------------
// Status: one file per person, only that person's agent writes it (R7)
// ---------------------------------------------------------------------------
export const StatusFrontmatter = z.object({
  login: GitHubLogin,
  /** ISO 8601 date-time with offset. */
  updated: z.string().min(1),
  doing: z.string().default(""),
  next: z.string().default(""),
  /** Empty string = not blocked. */
  blocked: z.string().default(""),
  fyi: z
    .array(z.object({ text: z.string().min(1), ref: z.string().optional() }))
    .max(3)
    .default([]),
  deliverables: z
    .array(z.object({ title: z.string().min(1), url: z.url() }))
    .max(5)
    .default([]),
});
export type StatusFrontmatter = z.infer<typeof StatusFrontmatter>;

export interface Status extends StatusFrontmatter {
  path: string;
  /** Free text below the frontmatter. */
  notes: string;
}

/** Input for `tandem status` (fields omitted = keep current value). */
export const StatusPatch = z.object({
  doing: z.string().optional(),
  next: z.string().optional(),
  blocked: z.string().optional(),
  fyi: StatusFrontmatter.shape.fyi.unwrap().optional(),
  deliverables: StatusFrontmatter.shape.deliverables.unwrap().optional(),
  notes: z.string().optional(),
});
export type StatusPatch = z.infer<typeof StatusPatch>;

// ---------------------------------------------------------------------------
// Problems found by `tandem check`
// ---------------------------------------------------------------------------
export interface Problem {
  path: string;
  severity: "error" | "warning";
  /** Short machine code, e.g. "missing-field", "duplicate-id". */
  code: string;
  /** Human message (Traditional Chinese). */
  message: string;
  fixable?: boolean;
}

// ---------------------------------------------------------------------------
// GitHub-side summaries (read model for brief and board)
// ---------------------------------------------------------------------------
export interface DiscussionSummary {
  id: string;
  number: number;
  title: string;
  url: string;
  kind: "question" | "disagreement" | "other";
  author: string;
  /** Logins named on the first line `等：@a @b`. */
  waitingOn: string[];
  /** Logins who commented (excluding the author). */
  commenters: string[];
  answered: boolean;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSummary {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  assignees: string[];
  labels: string[];
  author: string;
  /** Issue numbers that block this one (open ones only). */
  blockedBy: number[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  author: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  requestedReviewers: string[];
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
}

// ---------------------------------------------------------------------------
// Derived: who waits on whom
// ---------------------------------------------------------------------------
export interface WaitingItem {
  kind: "discussion" | "pr_review" | "blocked_issue";
  title: string;
  url: string;
  /** The person waiting. */
  from: string;
  /** The person being waited on. */
  to: string;
  /** ISO time the wait started. */
  since: string;
}

// ---------------------------------------------------------------------------
// `tandem brief --json` output (contracts/cli.md)
// ---------------------------------------------------------------------------
export interface BriefDecision {
  id: string;
  title: string;
  deciders: string[];
  strength: Strength;
  mentionsMe: boolean;
  path: string;
  url?: string;
}

export interface BriefTeammate {
  login: string;
  doing: string;
  blocked: string;
  fyi: string[];
  updated: string;
}

export interface Brief {
  me: string;
  repo: { owner: string; name: string };
  since: { commit: string | null; time: string | null };
  waitingOnMe: WaitingItem[];
  iAmWaitingOn: WaitingItem[];
  newDecisions: BriefDecision[];
  assignedToMe: { number: number; title: string; url: string }[];
  teammates: BriefTeammate[];
  problems: string[];
  /** True when nothing relevant changed since the last brief. */
  quiet: boolean;
}

// ---------------------------------------------------------------------------
// Board API (GET /api/board)
// ---------------------------------------------------------------------------
export interface BoardMember {
  login: string;
  status?: Status;
  waitingOn: WaitingItem[];
  waitedOnBy: WaitingItem[];
  openTasks: TaskSummary[];
  recentPullRequests: PullRequestSummary[];
}

export interface SyncState {
  state: "idle" | "syncing" | "conflict" | "offline" | "error";
  lastSyncAt?: string;
  message?: string;
}

export interface BoardData {
  repo: { owner: string; name: string; url: string };
  me: string;
  members: BoardMember[];
  waiting: WaitingItem[];
  discussions: DiscussionSummary[];
  tasks: TaskSummary[];
  pullRequests: PullRequestSummary[];
  decisions: Decision[];
  problems: Problem[];
  sync: SyncState;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export type TandemErrorCode =
  | "usage"
  | "validation"
  | "not_a_repo"
  | "no_remote"
  | "auth"
  | "needs_human"
  | "conflict"
  | "offline"
  | "github"
  | "internal";

export class TandemError extends Error {
  readonly code: TandemErrorCode;
  readonly details?: unknown;
  constructor(code: TandemErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "TandemError";
    this.code = code;
    this.details = details;
  }
}

/** CLI exit codes (contracts/cli.md). */
export const EXIT = { ok: 0, error: 1, usage: 2, needsHuman: 3 } as const;
