import { describe, expect, it } from "vitest";
import type { Decision, DiscussionSummary, PullRequestSummary, Status, TaskSummary } from "@tandem/contracts";
import { computeBrief, computeWaiting, renderAgentContext, renderBrief } from "./index.ts";

const disc = (over: Partial<DiscussionSummary> = {}): DiscussionSummary => ({
  id: "D_1", number: 1, title: "首頁要不要放影片", url: "https://github.com/o/r/discussions/1",
  kind: "question", author: "roy", waitingOn: ["jie"], commenters: [], answered: false, closed: false,
  createdAt: "2026-11-15T01:00:00Z", updatedAt: "2026-11-15T01:00:00Z", ...over,
});
const pr = (over: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: 4, title: "首頁", url: "https://github.com/o/r/pull/4", author: "jie", state: "open", draft: false,
  requestedReviewers: ["roy"], createdAt: "2026-11-15T01:00:00Z", updatedAt: "2026-11-15T02:00:00Z", ...over,
});
const task = (over: Partial<TaskSummary> = {}): TaskSummary => ({
  number: 5, title: "登入頁", url: "https://github.com/o/r/issues/5", state: "open", assignees: ["roy"], labels: [],
  author: "jie", blockedBy: [], createdAt: "2026-11-15T01:00:00Z", updatedAt: "2026-11-15T03:00:00Z", ...over,
});
const decision = (over: Partial<Decision["frontmatter"]> = {}, extra: Partial<Decision> = {}): Decision => ({
  frontmatter: { id: "D-20261115-k3f9", title: "登入先用 GitHub", date: "2026-11-15", deciders: ["roy"], consulted: [], strength: "preference", source: "chat", supersedes: [], ...over },
  path: "tandem/decisions/D-20261115-k3f9-login.md", quotes: [], decision: "x", why: "y", supersededBy: [], ...extra,
});
const status = (over: Partial<Status> = {}): Status => ({
  login: "roy", updated: "2026-11-15T03:00:00+08:00", doing: "串接 API", next: "", blocked: "", fyi: [], deliverables: [],
  path: "tandem/status/roy.md", notes: "", ...over,
});

describe("computeWaiting", () => {
  it("derives waits from discussions, PR reviews and blocked issues", () => {
    const w = computeWaiting({
      discussions: [disc()],
      pullRequests: [pr()],
      tasks: [task({ number: 6, assignees: ["jie"], blockedBy: [5] }), task()],
    });
    expect(w.map((x) => `${x.kind}:${x.from}->${x.to}`)).toEqual([
      "discussion:roy->jie",
      "pr_review:jie->roy",
      "blocked_issue:jie->roy",
    ]);
  });
  it("stops waiting once the person replied, or the discussion is answered/closed", () => {
    expect(computeWaiting({ discussions: [disc({ commenters: ["jie"] })], pullRequests: [], tasks: [] })).toEqual([]);
    expect(computeWaiting({ discussions: [disc({ answered: true })], pullRequests: [], tasks: [] })).toEqual([]);
    expect(computeWaiting({ discussions: [disc({ closed: true })], pullRequests: [], tasks: [] })).toEqual([]);
  });
  it("ignores drafts, closed blockers and self-waits", () => {
    expect(computeWaiting({ discussions: [disc({ waitingOn: ["roy"] })], pullRequests: [pr({ draft: true })], tasks: [] })).toEqual([]);
    expect(computeWaiting({ discussions: [], pullRequests: [], tasks: [task({ number: 6, blockedBy: [5] }), task({ state: "closed" })] })).toEqual([]);
  });
});

describe("computeBrief", () => {
  const base = {
    me: "jie",
    repo: { owner: "o", name: "r" },
    since: { commit: "abc", time: "2026-11-15T00:00:00Z" },
    discussions: [] as DiscussionSummary[],
    pullRequests: [] as PullRequestSummary[],
    tasks: [] as TaskSummary[],
    problems: [],
    statuses: [] as Status[],
    decisions: [] as Decision[],
    addedDecisionPaths: new Set<string>(),
    changedStatusPaths: new Set<string>(),
  };

  it("is quiet when nothing relevant changed", () => {
    const b = computeBrief(base);
    expect(b.quiet).toBe(true);
    expect(renderBrief(b)).toBe("上次之後沒有跟你有關的變動。");
  });

  it("reports new decisions by others, mentions first, and skips my own", () => {
    const mine = decision({ id: "D-20261115-aaaa", deciders: ["jie"] }, { path: "tandem/decisions/a.md" });
    const other = decision({ id: "D-20261115-bbbb", title: "部署用 Vercel" }, { path: "tandem/decisions/b.md" });
    const mentions = decision({ id: "D-20261115-cccc", consulted: ["jie"] }, { path: "tandem/decisions/c.md" });
    const b = computeBrief({
      ...base,
      decisions: [mine, other, mentions],
      addedDecisionPaths: new Set(["tandem/decisions/a.md", "tandem/decisions/b.md", "tandem/decisions/c.md"]),
    });
    expect(b.newDecisions.map((d) => d.id)).toEqual(["D-20261115-cccc", "D-20261115-bbbb"]);
    expect(b.newDecisions[0]?.url).toBe("https://github.com/o/r/blob/HEAD/tandem/decisions/c.md");
    expect(b.quiet).toBe(false);
  });

  it("includes waits, assignments and teammate status changes", () => {
    const b = computeBrief({
      ...base,
      discussions: [disc()],
      tasks: [task({ assignees: ["jie"] })],
      statuses: [status({ fyi: [{ text: "API 改版了" }] }), status({ login: "jie", path: "tandem/status/jie.md" })],
      changedStatusPaths: new Set(["tandem/status/roy.md"]),
    });
    expect(b.waitingOnMe).toHaveLength(1);
    expect(b.assignedToMe).toHaveLength(1);
    expect(b.teammates.map((t) => t.login)).toEqual(["roy"]);
    const text = renderBrief(b, new Date("2026-11-15T04:00:00Z"));
    expect(text).toContain("@roy 在等你回答：首頁要不要放影片（3 小時）");
    expect(text).toContain("要你知道：API 改版了");
    expect(text.split("\n").length).toBeLessThanOrEqual(8);
  });

  it("agent context carries the workflow and stays small", () => {
    const ctx = renderAgentContext(computeBrief({ ...base, discussions: [disc()] }));
    expect(ctx).toContain("tandem decide --input - --dry-run");
    expect(ctx).toContain("五行以內");
    expect(ctx.length).toBeLessThan(4000);
  });
});
