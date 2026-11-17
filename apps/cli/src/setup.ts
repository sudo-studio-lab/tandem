/**
 * Starting, joining and setting up projects. Shared by the CLI (`init`, `join`) and the
 * desktop server. Never touches the user's code: the only commit on the
 * user's branch is the agent setup files, and only on explicit setup.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PATHS, PRODUCT, TandemError, parseRepoFullName, type ProjectStep } from "@tandem/contracts";
import {
  createGitHubClient,
  installAgentIntegration,
  installPreCommitHook,
  runGit,
  updateAppState,
  projectIdFor,
  readTandemConfig,
  updateStatus,
} from "@tandem/core";
import { openContext, type Context } from "./context.ts";
import { verifyShareLink } from "./members.ts";

export type Progress = (step: ProjectStep, message: string) => void;
const noop: Progress = () => undefined;

export const TEAM_TEMPLATE = `# 團隊習慣

用白話寫這個團隊的習慣，每個人的 agent 開工時都會讀。想到再加，不用一次寫完。

例如：
- 設計相關的決定都要問 @某人
- 黑客松期間不開討論，直接記決定，有意見再提
`;

/** Files `setupProject` commits on the user's branch so teammates' agents get the same setup. */
const SETUP_PATHS = ["AGENTS.md", "CLAUDE.md", ".claude/settings.json", ".claude/skills", ".codex/hooks.json", ".agents/skills"];

export interface SetupResult {
  created: string[];
  discussions: "enabled" | "disabled-fallback-issues" | "unknown";
  pushed: boolean;
  problems: string[];
}

/**
 * Set a project up for Tandem (idempotent).
 * - records (team file, my status) go to the default branch through the store;
 * - agent setup files are written to the working tree, committed on the current branch, and pushed.
 */
export async function setupProject(
  ctx: Context,
  opts: { enableDiscussions: boolean | (() => Promise<boolean>); push?: boolean; progress?: Progress },
): Promise<SetupResult> {
  const progress = opts.progress ?? noop;
  const out: SetupResult = { created: [], discussions: "unknown", pushed: false, problems: [] };

  progress("setup", "建立團隊紀錄");
  if ((await ctx.store.read(PATHS.team)) === null) {
    await ctx.store.write([{ path: PATHS.team, content: TEAM_TEMPLATE, createOnly: true }], `${PRODUCT.command}: add team notes`);
    out.created.push(PATHS.team);
  }
  await updateStatus(ctx.store, ctx.me, {}, {});

  progress("setup", "設定 Claude Code 和 Codex");
  const changes = await installAgentIntegration(ctx.repoRoot);
  for (const c of changes) if (c.action !== "unchanged") out.created.push(c.path);
  await installPreCommitHook(
    ctx.repoRoot,
    `if command -v ${PRODUCT.command} >/dev/null 2>&1; then ${PRODUCT.command} check --quiet; fi`,
  );

  // Discussions: changing a repo setting needs consent; without it, fall back to Issues.
  try {
    const d = await ctx.gh.getDiscussionsInfo();
    if (d.enabled) out.discussions = "enabled";
    else {
      const yes = typeof opts.enableDiscussions === "function" ? await opts.enableDiscussions() : opts.enableDiscussions;
      if (yes) {
        await ctx.gh.enableDiscussions();
        out.discussions = "enabled";
      } else out.discussions = "disabled-fallback-issues";
    }
    await ctx.gh.ensureLabels();
  } catch (e) {
    out.problems.push(`設定 GitHub 時出了問題：${e instanceof Error ? e.message : String(e)}`);
  }

  // Commit only the setup files (pathspec), never anything else the user has staged.
  const paths = SETUP_PATHS.filter((p) => existsSync(path.join(ctx.repoRoot, p)));
  if (paths.length) {
    await runGit(["add", "--", ...paths], { cwd: ctx.repoRoot });
    const staged = await runGit(["diff", "--cached", "--quiet", "--", ...paths], { cwd: ctx.repoRoot, allowFail: true });
    if (staged.code !== 0) {
      await runGit(["commit", "-m", `${PRODUCT.command}: set up ${PRODUCT.displayName}`, "--", ...paths], { cwd: ctx.repoRoot });
    }
  }
  if (opts.push !== false) {
    progress("push", "上傳設定");
    out.pushed = await pushSetup(ctx).catch((e) => {
      out.problems.push(`設定還沒上傳：${e instanceof Error ? e.message : String(e)}`);
      return false;
    });
    const w = await ctx.store.flush();
    if (w.result === "offline") out.problems.push("目前離線，紀錄會在連上網後自動同步");
    else if (w.result === "conflict") out.problems.push(w.message ?? "同步紀錄時有衝突");
  }
  return out;
}

/** Push the setup commit on the current branch, only if the branch has nothing else unpushed. */
async function pushSetup(ctx: Context): Promise<boolean> {
  const branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ctx.repoRoot })).stdout.trim();
  if (!branch || branch === "HEAD") return false;
  const up = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: ctx.repoRoot, allowFail: true });
  const upstream = up.code === 0 ? up.stdout.trim() : null;
  if (upstream) {
    const ahead = (await runGit(["rev-list", "--count", `${upstream}..HEAD`], { cwd: ctx.repoRoot })).stdout.trim();
    if (ahead === "0") return true;
    // Don't push the user's own unpushed work along with ours.
    const subjects = (await runGit(["log", "--format=%s", `${upstream}..HEAD`], { cwd: ctx.repoRoot })).stdout.trim().split("\n");
    if (subjects.some((s) => !s.startsWith(`${PRODUCT.command}:`))) {
      throw new TandemError("needs_human", "這個分支上還有你自己沒推送的 commit，所以設定先留在本機。推送你的分支時會一起上去。");
    }
  }
  const r = await runGit(upstream ? ["push"] : ["push", "-u", "origin", branch], {
    cwd: ctx.repoRoot,
    env: ctx.gitEnv,
    allowFail: true,
    timeoutMs: 120_000,
  });
  if (r.code !== 0) throw new TandemError("github", `推送失敗：${r.stderr.trim().split("\n").pop() ?? ""}`, { stderr: r.stderr });
  return true;
}

// ---------------------------------------------------------------------------
// Clone / start / join
// ---------------------------------------------------------------------------
function freeDir(base: string): string {
  if (!existsSync(base) || readdirSync(base).length === 0) return base;
  for (let i = 2; i < 100; i++) {
    const p = `${base}-${i}`;
    if (!existsSync(p)) return p;
  }
  throw new TandemError("internal", `找不到可以用的資料夾名稱：${base}`);
}

export async function cloneRepo(owner: string, name: string, dir: string, gitEnv: Record<string, string>): Promise<void> {
  await mkdir(path.dirname(dir), { recursive: true });
  const r = await runGit(["clone", `https://github.com/${owner}/${name}.git`, dir], {
    cwd: path.dirname(dir),
    env: gitEnv,
    allowFail: true,
    timeoutMs: 10 * 60_000,
  });
  if (r.code !== 0) {
    throw new TandemError("github", "下載專案失敗，請確認你有這個 repo 的權限、網路正常", { stderr: r.stderr });
  }
}

/** Find an existing local clone of owner/name in the app's project list. */
async function knownPath(owner: string, name: string): Promise<string | null> {
  let found: string | null = null;
  await updateAppState((s) => {
    const p = s.projects.find((x) => x.id === projectIdFor(owner, name));
    if (p && existsSync(path.join(p.path, ".git"))) found = p.path;
  });
  return found;
}

export async function rememberProject(ctx: Context): Promise<string> {
  const id = projectIdFor(ctx.remote.owner, ctx.remote.name);
  await updateAppState((s) => {
    const now = new Date().toISOString();
    const existing = s.projects.find((p) => p.id === id);
    if (existing) {
      existing.path = ctx.repoRoot;
      existing.lastOpenedAt = now;
    } else s.projects.push({ id, owner: ctx.remote.owner, name: ctx.remote.name, path: ctx.repoRoot, lastOpenedAt: now });
    s.currentProjectId = id;
  });
  return id;
}

/** Clone (if needed), set up, remember. Used by "start from my repo", "new project" and "accept invite". */
export async function startProject(opts: {
  owner: string;
  name: string;
  token: string;
  projectsDir: string;
  dir?: string;
  enableDiscussions: boolean;
  /** Also accept a pending invitation to the project's data repo (see .tandem.json). */
  acceptDataInvite?: boolean;
  fromLink?: boolean;
  shareToken?: string;
  progress?: Progress;
}): Promise<{ projectId: string; dir: string; setup: SetupResult }> {
  const progress = opts.progress ?? noop;
  const { gitAuthEnv } = await import("@tandem/core");
  let dir = opts.dir ? path.resolve(opts.dir) : await knownPath(opts.owner, opts.name);
  if (!dir || !existsSync(path.join(dir, ".git"))) {
    dir = freeDir(dir ?? path.join(opts.projectsDir, opts.name));
    progress("clone", `下載到 ${dir}`);
    await cloneRepo(opts.owner, opts.name, dir, gitAuthEnv(opts.token));
  } else progress("clone", `這台電腦已經有了：${dir}`);
  if (opts.acceptDataInvite) await acceptDataRepoInvite(dir, opts.owner, opts.name, opts.token, progress);
  // Also sets up the local copy of the data repo when .tandem.json points to one.
  const ctx = await openContext(dir, { token: opts.token });
  if(opts.fromLink)await verifyShareLink(ctx,opts.shareToken);
  const setup = await setupProject(ctx, { enableDiscussions: opts.enableDiscussions, progress });
  const projectId = await rememberProject(ctx);
  progress("done", "完成");
  return { projectId, dir, setup };
}

/**
 * When team data lives in a separate repo, the invite comes as two invitations; accept the
 * data repo one together with the code repo one. Best effort: a missing invitation is fine
 * (already a member, or not invited yet), and openContext reports a real access problem.
 */
export async function acceptDataRepoInvite(dir: string, owner: string, name: string, token: string, progress: Progress = noop): Promise<void> {
  let cfg;
  try {
    cfg = await readTandemConfig(dir);
  } catch {
    return;
  }
  const target = cfg.dataRepo ? parseRepoFullName(cfg.dataRepo) : null;
  if (!target || `${target.owner}/${target.name}`.toLowerCase() === `${owner}/${name}`.toLowerCase()) return;
  progress("accept", `接受團隊資料 repo ${target.owner}/${target.name} 的邀請`);
  const gh = createGitHubClient({ token, owner: target.owner, repo: target.name });
  await gh.acceptInvitationFor().catch(() => undefined);
}

/** Accept a pending invitation (by repo) and start the project. */
export async function joinProject(opts: {
  owner: string;
  name: string;
  token: string;
  projectsDir: string;
  dir?: string;
  invitationId?: number;
  fromLink?: boolean;
  shareToken?: string;
  progress?: Progress;
}) {
  const progress = opts.progress ?? noop;
  const gh = createGitHubClient({ token: opts.token, owner: opts.owner, repo: opts.name });
  progress("accept", "接受邀請");
  if (opts.invitationId !== undefined) await gh.acceptInvitation(opts.invitationId);
  else await gh.acceptInvitationFor();
  return startProject({ ...opts, enableDiscussions: false, acceptDataInvite: true });
}
