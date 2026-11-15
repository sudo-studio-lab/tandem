import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { TandemError } from "@tandem/contracts";
import { getQueue } from "./queue.ts";
import { currentBranch } from "./repo.ts";
import { runGit } from "./run.ts";

export interface SyncResult {
  result: "ok" | "nothing" | "conflict" | "offline";
  committed: boolean;
  pulled: number;
  pushed: boolean;
  message?: string;
}

const NETWORK_RE =
  /could not resolve host|connection refused|failed to connect|timed out|network is unreachable|connection reset|could not read from remote repository|unable to connect|temporary failure in name resolution|no route to host|ssl connect error/i;

const NET_TIMEOUT = 120_000;

function isNetworkError(err: unknown): boolean {
  if (err instanceof TandemError) {
    const stderr = (err.details as { stderr?: string } | undefined)?.stderr;
    return NETWORK_RE.test(stderr ?? err.message);
  }
  return false;
}

function normDir(dataDir: string): string {
  return dataDir.replace(/\\/g, "/").replace(/\/+$/, "");
}

async function count(repoRoot: string, range: string): Promise<number> {
  const r = await runGit(["rev-list", "--count", range], { cwd: repoRoot, allowFail: true });
  return r.code === 0 ? Number.parseInt(r.stdout.trim(), 10) || 0 : 0;
}

async function inRebase(repoRoot: string): Promise<boolean> {
  for (const d of ["rebase-merge", "rebase-apply"]) {
    const r = await runGit(["rev-parse", "--git-path", d], { cwd: repoRoot });
    if (existsSync(resolve(repoRoot, r.stdout.trim()))) return true;
  }
  return false;
}

async function unmergedFiles(repoRoot: string): Promise<string[]> {
  const r = await runGit(["diff", "--name-only", "--diff-filter=U"], { cwd: repoRoot, allowFail: true });
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Returns the upstream ref, adopting origin/<branch> as upstream when it exists. Null if none. */
async function resolveUpstream(repoRoot: string, branch: string): Promise<string | null> {
  const up = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: repoRoot, allowFail: true });
  if (up.code === 0) return up.stdout.trim();
  const remoteRef = await runGit(["rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`], {
    cwd: repoRoot,
    allowFail: true,
  });
  if (remoteRef.code === 0) {
    await runGit(["branch", `--set-upstream-to=origin/${branch}`, branch], { cwd: repoRoot });
    return `origin/${branch}`;
  }
  return null;
}

type PullOutcome = { ok: true } | { ok: false; files: string[] };

async function pullRebase(repoRoot: string): Promise<PullOutcome> {
  const res = await runGit(["pull", "--rebase", "--autostash"], { cwd: repoRoot, allowFail: true, timeoutMs: NET_TIMEOUT });
  if (res.code === 0) {
    const stuck = await unmergedFiles(repoRoot);
    if (stuck.length) {
      throw new TandemError("internal", `同步完成，但暫存的本機修改與新內容衝突：${stuck.join(", ")}`, { files: stuck });
    }
    return { ok: true };
  }
  if (await inRebase(repoRoot)) {
    const files = await unmergedFiles(repoRoot);
    await runGit(["rebase", "--abort"], { cwd: repoRoot, allowFail: true });
    return { ok: false, files };
  }
  throw new TandemError("internal", `git pull 失敗：${res.stderr.trim()}`, { stderr: res.stderr });
}

function conflictResult(base: SyncResult, files: string[]): SyncResult {
  return {
    ...base,
    result: "conflict",
    message: `同步時有衝突，需要人處理：${files.join(", ")}（你的修改已保留在本機，尚未推送）`,
  };
}

async function syncInner(
  repoRoot: string,
  opts: { dataDir: string; message?: string; push?: boolean },
): Promise<SyncResult> {
  const dataDir = normDir(opts.dataDir);
  const out: SyncResult = { result: "nothing", committed: false, pulled: 0, pushed: false };
  const branch = await currentBranch(repoRoot);
  if (!branch) throw new TandemError("internal", "目前不在任何分支上（detached HEAD），無法同步。");

  // 1. Stage and commit only the data directory.
  const added = await runGit(["add", "-A", "--", dataDir], { cwd: repoRoot, allowFail: true });
  // A data dir that does not exist yet (fresh clone) is fine: nothing to stage.
  if (added.code !== 0 && !/did not match any files/i.test(added.stderr)) {
    throw new TandemError("internal", `git add 失敗：${added.stderr.trim()}`, { stderr: added.stderr });
  }
  const staged = await runGit(["diff", "--cached", "--name-only", "--", dataDir], { cwd: repoRoot });
  if (staged.stdout.trim()) {
    // The pathspec form commits only dataDir even if something else is staged.
    await runGit(["commit", "-m", opts.message ?? "tandem: update records", "--", dataDir], { cwd: repoRoot });
    out.committed = true;
  }

  try {
    const hasHead = (await runGit(["rev-parse", "--verify", "-q", "HEAD"], { cwd: repoRoot, allowFail: true })).code === 0;

    // 2. Fetch, then pull --rebase if behind.
    const fetched = await runGit(["fetch", "origin"], { cwd: repoRoot, allowFail: true, timeoutMs: NET_TIMEOUT });
    if (fetched.code !== 0) {
      throw new TandemError("internal", `git fetch 失敗：${fetched.stderr.trim()}`, { stderr: fetched.stderr });
    }
    const upstream = await resolveUpstream(repoRoot, branch);
    if (upstream) {
      const behind = hasHead ? await count(repoRoot, `HEAD..${upstream}`) : 0;
      if (behind > 0) {
        const pr = await pullRebase(repoRoot);
        if (!pr.ok) return conflictResult(out, pr.files);
        out.pulled = behind;
      }
    }

    // 3. Push.
    if (opts.push !== false && hasHead) {
      const ahead = upstream ? await count(repoRoot, `${upstream}..HEAD`) : 1;
      if (ahead > 0) {
        const args = upstream ? ["push"] : ["push", "-u", "origin", branch];
        let pushed = await runGit(args, { cwd: repoRoot, allowFail: true, timeoutMs: NET_TIMEOUT });
        if (pushed.code !== 0 && upstream && /rejected|fetch first|non-fast-forward/i.test(pushed.stderr)) {
          // Someone pushed between our fetch and push: pull once more and retry.
          const before = await count(repoRoot, `HEAD..${upstream}`);
          const pr = await pullRebase(repoRoot);
          if (!pr.ok) return conflictResult(out, pr.files);
          out.pulled += before;
          pushed = await runGit(args, { cwd: repoRoot, allowFail: true, timeoutMs: NET_TIMEOUT });
        }
        if (pushed.code !== 0) {
          throw new TandemError("internal", `git push 失敗：${pushed.stderr.trim()}`, { stderr: pushed.stderr });
        }
        out.pushed = true;
      }
    }
  } catch (err) {
    if (isNetworkError(err)) {
      return { ...out, result: "offline", message: "連不上遠端，稍後會自動重試。" };
    }
    throw err;
  }

  out.result = out.committed || out.pulled > 0 || out.pushed ? "ok" : "nothing";
  return out;
}

/** Commit `<dataDir>/`, pull --rebase --autostash, push. Never resolves conflicts, never force-pushes. */
export function syncData(
  repoRoot: string,
  opts: { dataDir: string; message?: string; push?: boolean },
): Promise<SyncResult> {
  return getQueue(repoRoot).run(() => syncInner(repoRoot, opts));
}

/** `git fetch` inside the repo queue. */
export function fetchRemote(repoRoot: string): Promise<{ result: "ok" | "offline" }> {
  return getQueue(repoRoot).run(async () => {
    const r = await runGit(["fetch", "origin"], { cwd: repoRoot, allowFail: true, timeoutMs: NET_TIMEOUT });
    if (r.code === 0) return { result: "ok" as const };
    if (NETWORK_RE.test(r.stderr)) return { result: "offline" as const };
    throw new TandemError("internal", `git fetch 失敗：${r.stderr.trim()}`, { stderr: r.stderr });
  });
}
