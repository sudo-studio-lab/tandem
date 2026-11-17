/**
 * Where team data lives. By default decisions, status and team.md live in the code repo itself.
 * When `.tandem.json` at the code repo root sets `dataRepo`, they live in that repo instead
 * (e.g. a private repo next to a public code repo). Tandem keeps a local copy of the data repo
 * under its per-user app state dir and reads/writes it through the same git data store.
 */
import fs from "node:fs";
import path from "node:path";
import { PRODUCT, TandemError, parseRepoFullName, parseTandemConfig, type TandemConfig } from "@tandem/contracts";
import { appStateDir } from "../app-state/state.ts";
import { runGit } from "../git/run.ts";
import { openGitDataStore } from "./git-store.ts";
import { withFileLock } from "./lock.ts";
import { NETWORK_RE } from "./net.ts";

export interface RepoRef {
  owner: string;
  name: string;
  url: string;
}

export interface DataLocation {
  /** Local git repo the data store reads and writes. The code repo root unless `separate`. */
  root: string;
  repo: RepoRef;
  /** True when data lives in a different repo than the code. */
  separate: boolean;
}

export interface DataRepoOptions {
  /** Env for git network commands (token auth). */
  gitEnv?: Record<string, string>;
  /** Remote URL for a data repo; defaults to its GitHub https URL. Tests point this at a local bare repo. */
  remoteUrlFor?: (owner: string, name: string) => string;
  /** Folder holding local data repo copies; defaults to <app state dir>/data. */
  baseDir?: string;
}

export const githubHttpsUrl = (owner: string, name: string): string => `https://github.com/${owner}/${name}.git`;

/**
 * Read `.tandem.json`: the working tree copy wins (so a change shows up before it is merged);
 * otherwise the copy on the code repo's remote default branch, so people on an older branch
 * follow the team's setting too. No file anywhere = `{}`.
 */
export async function readTandemConfig(repoRoot: string, gitEnv?: Record<string, string>): Promise<TandemConfig> {
  const file = path.join(repoRoot, PRODUCT.configFile);
  let text: string | null = null;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    // not in the working tree
  }
  if (text === null) {
    const branch = await openGitDataStore(repoRoot, { gitEnv }).defaultBranch().catch(() => "main");
    const r = await runGit(["cat-file", "blob", `refs/remotes/origin/${branch}:${PRODUCT.configFile}`], {
      cwd: repoRoot,
      allowFail: true,
    });
    if (r.code === 0) text = r.stdout;
  }
  return text === null ? {} : parseTandemConfig(text);
}

/** Merge `patch` into the working tree `.tandem.json` (other keys are kept). Returns the file path. */
export function writeTandemConfig(repoRoot: string, patch: Partial<TandemConfig>): string {
  const file = path.join(repoRoot, PRODUCT.configFile);
  let cur: TandemConfig = {};
  try {
    cur = parseTandemConfig(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e instanceof TandemError) throw e;
  }
  fs.writeFileSync(file, `${JSON.stringify({ ...cur, ...patch }, null, 2)}\n`, "utf8");
  return file;
}

/** Folder name for a data repo copy: lower-case "owner__name" (owners never contain "_"). */
export function dataRepoDir(owner: string, name: string, baseDir: string = path.join(appStateDir(), "data")): string {
  if (!parseRepoFullName(`${owner}/${name}`)) throw new TandemError("validation", `看不懂資料 repo 的名稱：${owner}/${name}`);
  return path.join(baseDir, `${owner}__${name}`.toLowerCase());
}

/**
 * Make sure a local copy of the data repo exists (git init + origin + first fetch) and return its root.
 * Never checks anything out: the data store only uses refs and objects. Works on a brand-new empty
 * remote (the first write creates the default branch). Offline is fine; the store retries later.
 */
export async function ensureDataRepo(owner: string, name: string, opts: DataRepoOptions = {}): Promise<string> {
  const dir = dataRepoDir(owner, name, opts.baseDir);
  const url = (opts.remoteUrlFor ?? githubHttpsUrl)(owner, name);
  const git = (args: string[]) => runGit(args, { cwd: dir, env: opts.gitEnv, allowFail: true });
  const ready = async (): Promise<boolean> => {
    if (!fs.existsSync(path.join(dir, ".git"))) return false;
    const r = await git(["remote", "get-url", "origin"]);
    return r.code === 0 && r.stdout.trim() === url;
  };
  if (await ready()) return dir;

  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await withFileLock(`${dir}.lock`, async () => {
    if (await ready()) return;
    fs.mkdirSync(dir, { recursive: true });
    const fresh = !fs.existsSync(path.join(dir, ".git"));
    if (fresh) {
      await runGit(["init", "-q", dir], { cwd: path.dirname(dir) });
      await runGit(["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: dir });
      await runGit(["config", "core.autocrlf", "false"], { cwd: dir });
    }
    const has = await git(["remote", "get-url", "origin"]);
    if (has.code !== 0) await runGit(["remote", "add", "origin", url], { cwd: dir });
    else await runGit(["remote", "set-url", "origin", url], { cwd: dir });
    const f = await runGit(["fetch", "--no-tags", "origin"], { cwd: dir, env: opts.gitEnv, allowFail: true, timeoutMs: 60_000 });
    if (f.code !== 0 && !NETWORK_RE.test(f.stderr)) {
      // No access or no such repo: don't keep a half-set-up copy, so the next run tries again.
      if (fresh) fs.rmSync(dir, { recursive: true, force: true });
      throw new TandemError("github", `讀不到資料 repo ${owner}/${name}，請確認它存在、而且你有權限`, { stderr: f.stderr });
    }
  });
  return dir;
}

/** Resolve where this project's team data lives, creating the local data repo copy when needed. */
export async function resolveDataLocation(repoRoot: string, code: RepoRef, opts: DataRepoOptions = {}): Promise<DataLocation> {
  const cfg = await readTandemConfig(repoRoot, opts.gitEnv);
  const target = cfg.dataRepo ? parseRepoFullName(cfg.dataRepo) : null;
  if (!target || (target.owner.toLowerCase() === code.owner.toLowerCase() && target.name.toLowerCase() === code.name.toLowerCase())) {
    return { root: repoRoot, repo: code, separate: false };
  }
  const root = await ensureDataRepo(target.owner, target.name, opts);
  return { root, repo: { ...target, url: `https://github.com/${target.owner}/${target.name}` }, separate: true };
}
