import { TandemError } from "@tandem/contracts";
import { openGitDataStore } from "../data/git-store.ts";
import { NETWORK_RE, isNetworkError } from "../data/net.ts";
import { getQueue } from "./queue.ts";
import { runGit } from "./run.ts";

export interface SyncResult {
  result: "ok" | "nothing" | "conflict" | "offline";
  committed: boolean;
  pulled: number;
  pushed: boolean;
  message?: string;
}

export interface SyncOptions {
  /** Kept for API compatibility; records now live in the DataStore paths. */
  dataDir?: string;
  message?: string;
  /** false: only fetch, do not flush the outbox. */
  push?: boolean;
  gitEnv?: Record<string, string>;
}

const NET_TIMEOUT = 120_000;
const OFFLINE = "連不上遠端，稍後會自動重試。";

async function count(repoRoot: string, range: string): Promise<number> {
  const r = await runGit(["rev-list", "--count", range], { cwd: repoRoot, allowFail: true });
  return r.code === 0 ? Number.parseInt(r.stdout.trim(), 10) || 0 : 0;
}

async function syncInner(repoRoot: string, opts: SyncOptions): Promise<SyncResult> {
  const out: SyncResult = { result: "nothing", committed: false, pulled: 0, pushed: false };
  const store = openGitDataStore(repoRoot, { gitEnv: opts.gitEnv });
  try {
    if (opts.push !== false) {
      const before = await store.pending();
      const r = await store.flush();
      if (r.result === "offline") return { ...out, result: "offline", message: r.message ?? OFFLINE };
      if (r.result === "conflict") return { ...out, result: "conflict", committed: !!r.commit, pushed: !!r.commit, message: r.message };
      if (r.result === "queued") {
        return { ...out, result: "ok", message: r.message };
      }
      if (r.commit) {
        out.committed = true;
        out.pushed = true;
      } else if (before > 0) {
        out.committed = false;
      }
    }

    // Refresh our view of the default branch (never touches the user's checkout).
    const branch = await store.defaultBranch();
    const ref = `refs/remotes/origin/${branch}`;
    const oldSha = await store.snapshot();
    const spec = `+refs/heads/${branch}:${ref}`;
    const f = await runGit(["fetch", "--no-tags", "origin", spec], {
      cwd: repoRoot,
      env: opts.gitEnv,
      allowFail: true,
      timeoutMs: NET_TIMEOUT,
    });
    if (f.code !== 0) {
      if (NETWORK_RE.test(f.stderr)) return { ...out, result: "offline", message: OFFLINE };
      if (!/couldn't find remote ref/i.test(f.stderr))
        throw new TandemError("internal", `git fetch 失敗：${f.stderr.trim()}`, { stderr: f.stderr });
    } else {
      const newSha = await store.snapshot();
      if (newSha && newSha !== oldSha) out.pulled = oldSha ? await count(repoRoot, `${oldSha}..${newSha}`) : await count(repoRoot, newSha);
    }
  } catch (err) {
    if (isNetworkError(err)) return { ...out, result: "offline", message: OFFLINE };
    throw err;
  }
  out.result = out.committed || out.pulled > 0 || out.pushed ? "ok" : "nothing";
  return out;
}

/**
 * Flush the records outbox to the remote default branch, then fetch it.
 * Never commits, pulls, rebases, stashes or pushes the user's own branch.
 */
export function syncData(repoRoot: string, opts: SyncOptions = {}): Promise<SyncResult> {
  return getQueue(repoRoot).run(() => syncInner(repoRoot, opts));
}

/** `git fetch` inside the repo queue. */
export function fetchRemote(repoRoot: string, gitEnv?: Record<string, string>): Promise<{ result: "ok" | "offline" }> {
  return getQueue(repoRoot).run(async () => {
    const r = await runGit(["fetch", "origin"], { cwd: repoRoot, env: gitEnv, allowFail: true, timeoutMs: NET_TIMEOUT });
    if (r.code === 0) return { result: "ok" as const };
    if (NETWORK_RE.test(r.stderr)) return { result: "offline" as const };
    throw new TandemError("internal", `git fetch 失敗：${r.stderr.trim()}`, { stderr: r.stderr });
  });
}
