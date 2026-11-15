import { describe, expect, it } from "vitest";
import type { ActivityRaw } from "../github/client.ts";
import { computeActivity } from "./compute.ts";

const now = new Date("2026-11-15T12:00:00");
const iso = (s: string) => new Date(s).toISOString();

function commit(oid: string, branch: string, at: string, login: string | null, headline = `msg ${oid}`) {
  return { oid, branch, headline, committedDate: iso(at), url: `https://github.com/o/r/commit/${oid}`, login };
}

const raw: ActivityRaw = {
  repoUrl: "https://github.com/o/r",
  commits: [
    commit("a1", "feat", "2026-11-15T10:00:00", "alice", "第三個"),
    commit("a2", "feat", "2026-11-15T09:00:00", "alice", "第二個"),
    commit("a3", "feat", "2026-11-15T08:00:00", "Alice", "第一個"),
    // same oid reachable from main too: counted once
    commit("a1", "main", "2026-11-15T10:00:00", "alice"),
    commit("b1", "main", "2026-11-14T10:00:00", "bob", "fix"),
    commit("x1", "main", "2026-11-14T11:00:00", null, "no github user"),
    commit("old", "main", "2026-11-01T10:00:00", "bob", "too old"),
    commit("z1", "main", "2026-11-14T11:00:00", "stranger", "not a member"),
  ],
  pullRequests: [
    { number: 3, title: "加看板", url: "u/pr3", author: "alice", createdAt: iso("2026-11-13T10:00:00"), mergedAt: iso("2026-11-14T15:00:00"), mergedBy: "bob" },
    { number: 4, title: "舊的", url: "u/pr4", author: "alice", createdAt: iso("2026-10-01T10:00:00"), mergedAt: null, mergedBy: null },
  ],
  comments: [
    { login: "bob", title: "要不要用 Electron", url: "u/c1", createdAt: iso("2026-11-15T11:00:00") },
    { login: "carol", title: "#7", url: "u/c2", createdAt: iso("2026-11-15T11:30:00") },
  ],
};

describe("computeActivity", () => {
  const r = computeActivity(raw, { members: ["alice", "bob", "dave"], now });

  it("includes every member, even without activity", () => {
    expect(Object.keys(r)).toEqual(["alice", "bob", "dave"]);
    expect(r.dave).toEqual([]);
  });

  it("groups commits per branch per day and dedupes by oid", () => {
    const commits = r.alice!.filter((i) => i.kind === "commit");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      title: "推了 3 個 commit 到 feat：第三個",
      count: 3,
      branch: "feat",
      url: "https://github.com/o/r/commit/a1",
      login: "alice",
    });
  });

  it("drops commits without a login, from non-members or outside the window", () => {
    expect(r.bob!.filter((i) => i.kind === "commit").map((i) => i.title)).toEqual(["推了 1 個 commit 到 main：fix"]);
    expect(JSON.stringify(r)).not.toContain("no github user");
    expect(JSON.stringify(r)).not.toContain("too old");
    expect(JSON.stringify(r)).not.toContain("not a member");
  });

  it("splits the same branch across days", () => {
    const two = computeActivity(
      { ...raw, commits: [commit("c1", "main", "2026-11-14T10:00:00", "bob"), commit("c2", "main", "2026-11-15T10:00:00", "bob")], pullRequests: [], comments: [] },
      { members: ["bob"], now },
    );
    expect(two.bob).toHaveLength(2);
  });

  it("opens PRs for the author and merges for mergedBy", () => {
    expect(r.alice!.find((i) => i.kind === "pr_opened")).toMatchObject({ title: "加看板", url: "u/pr3" });
    expect(r.bob!.find((i) => i.kind === "pr_merged")).toMatchObject({ title: "加看板", login: "bob" });
    expect(r.alice!.some((i) => i.kind === "pr_merged")).toBe(false);
    expect(r.alice!.some((i) => i.title === "舊的")).toBe(false);
  });

  it("turns comments into items", () => {
    expect(r.bob!.find((i) => i.kind === "comment")?.title).toBe("在「要不要用 Electron」留言");
  });

  it("is newest first and capped per member", () => {
    const times = r.bob!.map((i) => Date.parse(i.time));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const many: ActivityRaw = {
      repoUrl: "u",
      pullRequests: [],
      comments: Array.from({ length: 15 }, (_, i) => ({ login: "bob", title: `t${i}`, url: "u", createdAt: iso(`2026-11-1${i < 5 ? 0 : 1}T0${i % 9}:00:00`) })),
      commits: [],
    };
    expect(computeActivity(many, { members: ["bob"], now }).bob).toHaveLength(10);
    expect(computeActivity(many, { members: ["bob"], now, perMember: 3 }).bob).toHaveLength(3);
  });
});
