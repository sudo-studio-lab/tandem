import path from "node:path";
import { TandemError } from "@tandem/contracts";
import { runGit } from "./run.ts";

export async function findRepoRoot(cwd: string): Promise<string> {
  let res;
  try {
    res = await runGit(["rev-parse", "--show-toplevel"], { cwd, allowFail: true });
  } catch {
    throw new TandemError("not_a_repo", "這裡不是 git 專案資料夾。", { cwd });
  }
  if (res.code !== 0 || !res.stdout.trim()) {
    throw new TandemError("not_a_repo", "這裡不是 git 專案資料夾。", { cwd });
  }
  return path.resolve(res.stdout.trim());
}

/** Absolute git dir (handles worktrees). */
export async function getGitDir(repoRoot: string): Promise<string> {
  const res = await runGit(["rev-parse", "--absolute-git-dir"], { cwd: repoRoot });
  return path.resolve(res.stdout.trim());
}

/** Parse a remote URL into owner/name and a web URL. Returns null if unrecognised. */
export function parseRemoteUrl(raw: string): { owner: string; name: string; url: string } | null {
  const u = raw.trim();
  const urlLike = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(u);
  const scp = /^(?:[^@\s/]+@)?([^:\s/]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(u);
  const m = urlLike ?? scp;
  if (!m) return null;
  const [, host, owner, name] = m;
  if (!host || !owner || !name) return null;
  return { owner, name, url: `https://${host}/${owner}/${name}` };
}

export async function getRemoteRepo(
  repoRoot: string,
  remote = "origin",
): Promise<{ owner: string; name: string; url: string }> {
  const res = await runGit(["remote", "get-url", remote], { cwd: repoRoot, allowFail: true });
  const raw = res.stdout.trim();
  if (res.code !== 0 || !raw) {
    throw new TandemError("no_remote", `這個專案沒有設定遠端「${remote}」。`, { remote });
  }
  const parsed = parseRemoteUrl(raw);
  if (!parsed) throw new TandemError("no_remote", `看不懂遠端網址：${raw}`, { remote, url: raw });
  return parsed;
}

/** HEAD commit sha, or null when the repo has no commits. */
export async function headCommit(repoRoot: string): Promise<string | null> {
  const res = await runGit(["rev-parse", "--verify", "-q", "HEAD"], { cwd: repoRoot, allowFail: true });
  return res.code === 0 ? res.stdout.trim() : null;
}

/** Current branch name, or null on a detached HEAD. */
export async function currentBranch(repoRoot: string): Promise<string | null> {
  const res = await runGit(["symbolic-ref", "--short", "-q", "HEAD"], { cwd: repoRoot, allowFail: true });
  return res.code === 0 ? res.stdout.trim() : null;
}
