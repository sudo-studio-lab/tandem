/**
 * Brief: what changed that affects me, and who waits on whom.
 * Pure functions only — callers gather inputs from records, git and GitHub.
 */
import {
  PRODUCT,
  type Brief,
  type BriefDecision,
  type BriefTeammate,
  type Decision,
  type DiscussionSummary,
  type Problem,
  type PullRequestSummary,
  type Status,
  type TaskSummary,
  type WaitingItem,
} from "@tandem/contracts";

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hasLogin = (list: readonly string[], login: string) => list.some((x) => sameLogin(x, login));

/** Who waits on whom, derived from open discussions, PR review requests and blocked issues. */
export function computeWaiting(input: {
  discussions: readonly DiscussionSummary[];
  pullRequests: readonly PullRequestSummary[];
  tasks: readonly TaskSummary[];
}): WaitingItem[] {
  const items: WaitingItem[] = [];

  for (const d of input.discussions) {
    if (d.closed || d.answered) continue;
    for (const to of d.waitingOn) {
      if (sameLogin(to, d.author) || hasLogin(d.commenters, to)) continue;
      items.push({ kind: "discussion", title: d.title, url: d.url, from: d.author, to, since: d.createdAt });
    }
  }

  for (const pr of input.pullRequests) {
    if (pr.state !== "open" || pr.draft) continue;
    for (const to of pr.requestedReviewers) {
      if (sameLogin(to, pr.author)) continue;
      items.push({ kind: "pr_review", title: pr.title, url: pr.url, from: pr.author, to, since: pr.updatedAt });
    }
  }

  const byNumber = new Map(input.tasks.map((t) => [t.number, t]));
  for (const t of input.tasks) {
    if (t.state !== "open") continue;
    for (const blockerNo of t.blockedBy) {
      const blocker = byNumber.get(blockerNo);
      if (!blocker || blocker.state !== "open") continue;
      for (const from of t.assignees) {
        for (const to of blocker.assignees) {
          if (sameLogin(from, to)) continue;
          items.push({ kind: "blocked_issue", title: `${t.title}（被 #${blocker.number} 擋住）`, url: t.url, from, to, since: t.updatedAt });
        }
      }
    }
  }

  // De-duplicate identical (kind, url, from, to).
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.kind}|${i.url}|${i.from.toLowerCase()}|${i.to.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decisionMentions(d: Decision, me: string): boolean {
  if (hasLogin(d.frontmatter.consulted, me)) return true;
  if (d.quotes.some((q) => sameLogin(q.by, me))) return true;
  const text = [d.decision, d.why, d.scope ?? "", d.optionsConsidered ?? ""].join("\n").toLowerCase();
  return text.includes(`@${me.toLowerCase()}`);
}

const isAfter = (iso: string | undefined, since: string | null) =>
  !since || !iso ? true : Date.parse(iso) > Date.parse(since);

export interface BriefInput {
  me: string;
  repo: { owner: string; name: string };
  since: { commit: string | null; time: string | null };
  decisions: readonly Decision[];
  /** Repo-relative paths of decision files added since `since` (from git). */
  addedDecisionPaths: ReadonlySet<string>;
  /** Repo-relative paths of status files changed since `since` (from git). */
  changedStatusPaths: ReadonlySet<string>;
  statuses: readonly Status[];
  discussions: readonly DiscussionSummary[];
  pullRequests: readonly PullRequestSummary[];
  tasks: readonly TaskSummary[];
  problems: readonly Problem[];
}

export function computeBrief(input: BriefInput): Brief {
  const { me } = input;
  const base = `https://github.com/${input.repo.owner}/${input.repo.name}`;
  const waiting = computeWaiting(input);

  const newDecisions: BriefDecision[] = input.decisions
    .filter((d) => input.addedDecisionPaths.has(d.path))
    // Decisions made only by me are not news to me.
    .filter((d) => !(d.frontmatter.deciders.length > 0 && d.frontmatter.deciders.every((x) => sameLogin(x, me))))
    .map((d) => ({
      id: d.frontmatter.id,
      title: d.frontmatter.title,
      deciders: d.frontmatter.deciders,
      strength: d.frontmatter.strength,
      mentionsMe: decisionMentions(d, me),
      path: d.path,
      url: `${base}/blob/HEAD/${d.path}`,
    }))
    // Ones that mention me first, then stronger ones.
    .sort((a, b) => Number(b.mentionsMe) - Number(a.mentionsMe) || strengthRank(a.strength) - strengthRank(b.strength));

  const assignedToMe = input.tasks
    .filter((t) => t.state === "open" && hasLogin(t.assignees, me) && isAfter(t.updatedAt, input.since.time))
    .map((t) => ({ number: t.number, title: t.title, url: t.url }));

  const teammates: BriefTeammate[] = input.statuses
    .filter((s) => !sameLogin(s.login, me))
    .filter((s) => input.changedStatusPaths.has(s.path) || s.blocked !== "")
    .map((s) => ({ login: s.login, doing: s.doing, blocked: s.blocked, fyi: s.fyi.map((f) => f.text), updated: s.updated }));

  const waitingOnMe = waiting.filter((w) => sameLogin(w.to, me));
  const iAmWaitingOn = waiting.filter((w) => sameLogin(w.from, me));
  const problems = input.problems.filter((p) => p.severity === "error").map((p) => `${p.path}：${p.message}`);

  const quiet =
    newDecisions.length === 0 &&
    assignedToMe.length === 0 &&
    waitingOnMe.length === 0 &&
    !teammates.some((t) => input.changedStatusPaths.has(statusPathFor(input.statuses, t.login))) &&
    problems.length === 0;

  return {
    me,
    repo: input.repo,
    since: input.since,
    waitingOnMe,
    iAmWaitingOn,
    newDecisions,
    assignedToMe,
    teammates,
    problems,
    quiet,
  };
}

function statusPathFor(statuses: readonly Status[], login: string): string {
  return statuses.find((s) => sameLogin(s.login, login))?.path ?? "";
}

function strengthRank(s: string): number {
  return ["hard", "preference", "hunch", "one-off"].indexOf(s);
}

const MAX_ITEMS = 5;

function ago(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "不到 1 小時";
  if (h < 48) return `${h} 小時`;
  return `${Math.floor(h / 24)} 天`;
}

/** Human-readable brief (also used inside the agent context). Traditional Chinese, compact. */
export function renderBrief(brief: Brief, now: Date = new Date()): string {
  if (brief.quiet && brief.iAmWaitingOn.length === 0) return "上次之後沒有跟你有關的變動。";
  const lines: string[] = [];

  for (const w of brief.waitingOnMe.slice(0, MAX_ITEMS)) {
    const what = w.kind === "pr_review" ? "等你審 PR" : w.kind === "blocked_issue" ? "被你的任務擋住" : "在等你回答";
    lines.push(`• @${w.from} ${what}：${w.title}（${ago(w.since, now)}）${w.url}`);
  }
  if (brief.waitingOnMe.length > MAX_ITEMS) lines.push(`• 還有 ${brief.waitingOnMe.length - MAX_ITEMS} 件在等你`);

  for (const d of brief.newDecisions.slice(0, MAX_ITEMS)) {
    const who = d.deciders.map((x) => `@${x}`).join("、");
    lines.push(`• ${who} 新決定${d.mentionsMe ? "（提到你）" : ""}：${d.title}（${d.id}）`);
  }
  if (brief.newDecisions.length > MAX_ITEMS) lines.push(`• 還有 ${brief.newDecisions.length - MAX_ITEMS} 筆新決定`);

  for (const t of brief.assignedToMe.slice(0, MAX_ITEMS)) lines.push(`• 指派給你：#${t.number} ${t.title} ${t.url}`);

  for (const t of brief.teammates.slice(0, MAX_ITEMS)) {
    const parts = [t.doing ? `在做：${t.doing}` : "", t.blocked ? `卡在：${t.blocked}` : "", ...t.fyi.map((f) => `要你知道：${f}`)].filter(Boolean);
    if (parts.length) lines.push(`• @${t.login} ${parts.join("；")}`);
  }

  for (const w of brief.iAmWaitingOn.slice(0, 3)) lines.push(`• 你在等 @${w.to}：${w.title}（${ago(w.since, now)}）`);
  for (const p of brief.problems.slice(0, 3)) lines.push(`• 紀錄有問題：${p}`);

  return lines.length ? `上次之後：\n${lines.join("\n")}` : "上次之後沒有跟你有關的變動。";
}

/**
 * Text injected into the agent's context at session start.
 * Kept well under Codex's ~2,500-token SessionStart limit.
 */
export function renderAgentContext(brief: Brief, now: Date = new Date()): string {
  const cmd = PRODUCT.command;
  return [
    `## ${PRODUCT.displayName} 開工報告（給 agent）`,
    `使用者：@${brief.me}　專案：${brief.repo.owner}/${brief.repo.name}`,
    "",
    renderBrief(brief, now),
    "",
    "請在你的第一個回覆，用五行以內把上面跟使用者有關的部分告訴使用者（附連結）；如果寫著沒有變動，就不用提。",
    "",
    "### 工作方式",
    `- 使用者做了會影響別人的決定：用 \`${cmd} decide --input - --dry-run\` 產生紀錄，給使用者看「我記成這樣，對嗎？」，確認後去掉 --dry-run 正式寫入。原話必須逐字。`,
    `- 沒有別人的答案就做不下去：\`${cmd} ask <帳號> --title … --body …\`。可以先做、之後再改的事，直接記決定。`,
    `- 一段工作結束、或使用者要離開：\`${cmd} status --doing … --next … [--blocked …] [--deliverable 標題=網址]\`，只更新使用者自己的狀態。`,
    `- 不要改別人的狀態檔和別人的決定；要推翻決定就新增一筆並寫 supersedes。`,
    `- 有 \`${cmd}_decide\`、\`${cmd}_ask\`、\`${cmd}_status\` 這些工具時直接用工具（效果和上面的指令一樣，不用打指令）。`,
  ].join("\n");
}
