/** Collect everything brief and board need from records, git and GitHub. */
import {
  CONTEXT_DIR,
  PATHS,
  PRODUCT,
  type BriefContextChange,
  type ContextFileInfo,
  type BoardData,
  type BoardMember,
  type Brief,
  type Decision,
  type DiscussionSummary,
  type Problem,
  type PullRequestSummary,
  type SyncState,
  type TaskSummary,
} from "@tandem/contracts";
import {
  changesSince,
  checkRecords,
  computeBrief,
  computeWaiting,
  contextHistory,
  listContext,
  loadDecisions,
  loadStatuses,
  notesHead,
} from "@tandem/core";
import type { Context } from "./context.ts";
import { listHandoffs } from "./handoffs.ts";

export interface GitHubData {
  discussions: DiscussionSummary[];
  pullRequests: PullRequestSummary[];
  tasks: TaskSummary[];
  problems: Problem[];
}

export async function gatherGitHub(ctx: Context): Promise<GitHubData> {
  const out: GitHubData = { discussions: [], pullRequests: [], tasks: [], problems: [] };
  const note = (what: string, e: unknown) =>
    out.problems.push({
      path: `github:${what}`,
      severity: "warning",
      code: "github-unavailable",
      message: `暫時讀不到 GitHub 的${what}：${e instanceof Error ? e.message : String(e)}`,
    });
  try {
    out.discussions = await ctx.gh.listDiscussions();
  } catch (e) {
    note("討論", e);
  }
  try {
    out.pullRequests = await ctx.gh.listPullRequests({ state: "all" });
  } catch (e) {
    note("PR", e);
  }
  try {
    out.tasks = await ctx.gh.listIssues({ state: "all" });
  } catch (e) {
    note("任務", e);
  }
  return out;
}

export async function gatherLocal(ctx: Context) {
  const [{ decisions, problems: loadProblems }, statusesResult, check] = await Promise.all([
    loadDecisions(ctx.store),
    loadStatuses(ctx.store),
    checkRecords(ctx.store, {}),
  ]);
  const statuses = Array.isArray(statusesResult) ? statusesResult : statusesResult.statuses;
  const statusProblems: Problem[] = Array.isArray(statusesResult) ? [] : (statusesResult.problems ?? []);
  // checkRecords is a superset of load problems; de-duplicate by path+code.
  const seen = new Set<string>();
  const problems = [...check.problems, ...loadProblems, ...statusProblems].filter((p) => {
    const k = `${p.path}|${p.code}|${p.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { decisions, statuses, problems };
}

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Context files someone else changed, given repo-relative paths that changed (newest first). */
export async function contextChangesFor(
  ctx: Pick<Context, "store" | "me">,
  changedPaths: string[],
  files: ContextFileInfo[],
): Promise<BriefContextChange[]> {
  const prefix = `${CONTEXT_DIR}/`;
  const rels = [...new Set(changedPaths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)))];
  if (!rels.length) return [];
  const hist = await contextHistory(ctx.store);
  const present = new Set(files.map((f) => f.path));
  return rels
    .map((path) => ({ path, by: hist.get(path)?.by, deleted: !present.has(path) }))
    .filter((c) => !(c.by && sameLogin(c.by, ctx.me)))
    .map((c) => ({ path: c.path, deleted: c.deleted, ...(c.by ? { by: c.by } : {}) }));
}

export async function buildBrief(
  ctx: Context,
  gh: GitHubData | null,
): Promise<{ brief: Brief; head: string | null; decisions: Decision[]; contextFiles: ContextFileInfo[] }> {
  const since = ctx.state.lastBrief ?? { commit: null, time: null };
  const [local, changes, head, contextFiles, notes] = await Promise.all([
    gatherLocal(ctx),
    changesSince(ctx.dataRoot, since.commit, [PRODUCT.dataDir]),
    ctx.store.snapshot(),
    listContext(ctx.store).catch(() => [] as ContextFileInfo[]),
    notesHead(ctx.store).catch(() => undefined),
  ]);
  const contextChanges = await contextChangesFor(
    ctx,
    changes.files.map((f) => f.path),
    contextFiles,
  ).catch(() => [] as BriefContextChange[]);
  const added = new Set(
    changes.files.filter((f) => f.status === "A" && f.path.startsWith(`${PATHS.decisions}/`)).map((f) => f.path),
  );
  const changedStatus = new Set(
    changes.files.filter((f) => f.status !== "D" && f.path.startsWith(`${PATHS.status}/`)).map((f) => f.path),
  );
  const data = gh ?? { discussions: [], pullRequests: [], tasks: [], problems: [] };
  const brief = computeBrief({
    me: ctx.me,
    repo: { owner: ctx.remote.owner, name: ctx.remote.name },
    dataRepo: { owner: ctx.dataRepo.owner, name: ctx.dataRepo.name },
    since: { commit: since.commit, time: since.time },
    decisions: local.decisions,
    addedDecisionPaths: added,
    changedStatusPaths: changedStatus,
    statuses: local.statuses,
    discussions: data.discussions,
    pullRequests: data.pullRequests,
    tasks: data.tasks,
    problems: local.problems,
    contextChanges,
    ...(notes ? { notesHead: notes } : {}),
  });
  if (!gh) brief.problems.push("這次沒有讀 GitHub（連線逾時或離線），討論和任務可能不是最新的");
  const handoffs=(await listHandoffs(ctx)).filter(h=>h.to.toLowerCase()===ctx.me.toLowerCase()&&(!since.time||h.at>since.time));
  if(handoffs.length){brief.handoffs=handoffs.map(h=>({id:h.id,from:h.from,task:h.task,note:h.note}));brief.quiet=false;}
  return { brief, head, decisions: local.decisions, contextFiles };
}

/** `extraLogins`: collaborators and people seen in activity, so nobody with access is missing. */
export async function buildBoard(ctx: Context, gh: GitHubData, sync: SyncState, extraLogins: string[] = []): Promise<BoardData> {
  const local = await gatherLocal(ctx);
  const waiting = computeWaiting(gh);
  const logins = new Map<string, string>();
  const add = (l: string | undefined) => {
    if (l && !logins.has(l.toLowerCase())) logins.set(l.toLowerCase(), l);
  };
  add(ctx.me);
  local.statuses.forEach((s) => add(s.login));
  extraLogins.forEach(add);
  gh.tasks.filter((t) => t.state === "open").forEach((t) => t.assignees.forEach(add));
  waiting.forEach((w) => {
    add(w.from);
    add(w.to);
  });

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const members: BoardMember[] = [...logins.values()].map((login) => ({
    login,
    status: local.statuses.find((s) => sameLogin(s.login, login)),
    waitingOn: waiting.filter((w) => sameLogin(w.from, login)),
    waitedOnBy: waiting.filter((w) => sameLogin(w.to, login)),
    openTasks: gh.tasks.filter((t) => t.state === "open" && t.assignees.some((a) => sameLogin(a, login))),
    recentPullRequests: gh.pullRequests.filter(
      (p) =>
        sameLogin(p.author, login) &&
        (p.state === "open" || (p.mergedAt !== undefined && Date.parse(p.mergedAt) > weekAgo)),
    ),
  }));
  members.sort((a, b) => Number(sameLogin(b.login, ctx.me)) - Number(sameLogin(a.login, ctx.me)));

  const twoWeeksAgo = Date.now() - 14 * 24 * 3600 * 1000;
  return {
    repo: { owner: ctx.remote.owner, name: ctx.remote.name, url: `https://github.com/${ctx.remote.owner}/${ctx.remote.name}` },
    dataRepo: { owner: ctx.dataRepo.owner, name: ctx.dataRepo.name, url: `https://github.com/${ctx.dataRepo.owner}/${ctx.dataRepo.name}` },
    me: ctx.me,
    members,
    waiting,
    discussions: gh.discussions.filter((d) => !d.closed || Date.parse(d.updatedAt) > twoWeeksAgo),
    tasks: gh.tasks.filter((t) => t.state === "open" || (t.closedAt !== undefined && Date.parse(t.closedAt) > twoWeeksAgo)),
    pullRequests: gh.pullRequests.filter((p) => p.state === "open" || Date.parse(p.updatedAt) > twoWeeksAgo),
    decisions: local.decisions,
    problems: [...local.problems, ...gh.problems],
    sync,
    generatedAt: new Date().toISOString(),
  };
}
