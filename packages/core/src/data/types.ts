export interface FileChange {
  /** Repo-relative path with forward slashes, e.g. "tandem/status/alice.md". */
  path: string;
  /** Exact file content (UTF-8, LF; or base64 bytes, see encoding). null deletes the file. */
  content: string | null;
  /** "base64": content is base64-encoded bytes (images). Default UTF-8 text. */
  encoding?: "base64";
  /** Fail (conflict) when the path already exists. Used for decisions. */
  createOnly?: boolean;
  /**
   * Optimistic lock: the git blob sha the path must have on the remote when this change lands
   * (null: must not exist). Checked again at push time; a mismatch is a conflict.
   */
  expectVersion?: string | null;
}

/** A file under a prefix, with its git blob sha. */
export interface TreeEntry {
  /** Repo-relative path. */
  path: string;
  /** Git blob sha of the content. */
  version: string;
  size: number;
  /** Only in this computer's outbox so far. */
  pending?: boolean;
}

/** The last change to a path (newest commit, or the outbox). */
export interface PathChange {
  message: string;
  authorName: string;
  at: string;
  pending?: boolean;
}

export interface WriteResult {
  /**
   * pushed: on the remote default branch (or written, for the fs store).
   * queued: saved locally in the outbox, push failed for a reason other than being offline (see message).
   * offline: saved in the outbox, the remote is unreachable; retried later.
   * conflict: a createOnly path already exists on the remote; the write was set aside.
   */
  result: "pushed" | "queued" | "offline" | "conflict";
  commit?: string;
  message?: string;
  conflicts?: string[];
}

export interface DataStore {
  readonly repoRoot: string;
  readonly kind: "git" | "fs";
  defaultBranch(): Promise<string>;
  /** .md file names under tandem/<dir>/, sorted. */
  list(dir: "decisions" | "status"): Promise<string[]>;
  read(path: string): Promise<string | null>;
  /** Raw bytes (binary-safe), or null. */
  readBytes(path: string): Promise<Buffer | null>;
  /** Every file under `prefix` (recursive), sorted by path. */
  tree(prefix: string): Promise<TreeEntry[]>;
  /** Last change per path under `prefix`, including deleted paths (best effort, recent history). */
  history(prefix: string): Promise<Map<string, PathChange>>;
  write(changes: FileChange[], message: string): Promise<WriteResult>;
  /** Retry the outbox. result is "pushed" when the outbox is empty afterwards. */
  flush(): Promise<WriteResult>;
  /** Number of outbox entries. */
  pending(): Promise<number>;
  /** Commit sha of origin/<default branch>, or null. */
  snapshot(): Promise<string | null>;
}

export interface GitDataStoreOptions {
  /** Extra environment for every git call (e.g. token auth). Never written to config or argv. */
  gitEnv?: Record<string, string>;
  /** Commit author; defaults to the repo's user.name / user.email. */
  author?: { name: string; email: string };
  remote?: string;
}
