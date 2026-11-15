import { describe, expect, it } from "vitest";
import type { AppSettings, ProjectBoard } from "@tandem/contracts";
import { attentionCount, computeNotifications } from "./compute.ts";

const settings: AppSettings = { notifications: { waiting: true, review: true, task: true }, openAtLogin: false };
const now = new Date("2026-11-15T12:00:00Z");

const board = {
  projectId: "o/r",
  waiting: [
    { kind: "discussion", title: "要用哪個資料庫？", url: "d/1", from: "alice", to: "me", since: "2026-11-15T01:00:00Z" },
    { kind: "pr_review", title: "加看板", url: "pr/2", from: "alice", to: "me", since: "2026-11-15T02:00:00Z" },
    { kind: "discussion", title: "別人的", url: "d/9", from: "alice", to: "bob", since: "2026-11-15T01:00:00Z" },
  ],
  pullRequests: [
    { number: 2, title: "加看板", url: "pr/2", author: "alice", state: "open", draft: false, requestedReviewers: ["me"], createdAt: "", updatedAt: "2026-11-15T03:00:00Z" },
    { number: 5, title: "另一個", url: "pr/5", author: "carol", state: "open", draft: false, requestedReviewers: ["ME"], createdAt: "", updatedAt: "2026-11-15T04:00:00Z" },
    { number: 6, title: "已合併", url: "pr/6", author: "carol", state: "merged", draft: false, requestedReviewers: ["me"], createdAt: "", updatedAt: "" },
  ],
  tasks: [
    { number: 7, title: "寫文件", url: "t/7", state: "open", assignees: ["me"], labels: [], author: "alice", blockedBy: [], createdAt: "2026-11-14T00:00:00Z", updatedAt: "" },
    { number: 8, title: "自己開的", url: "t/8", state: "open", assignees: ["me"], labels: [], author: "me", blockedBy: [], createdAt: "", updatedAt: "" },
    { number: 9, title: "已關閉", url: "t/9", state: "closed", assignees: ["me"], labels: [], author: "alice", blockedBy: [], createdAt: "", updatedAt: "" },
  ],
} as unknown as ProjectBoard;

describe("computeNotifications", () => {
  it("emits one notification per new thing waiting on me, deduping PR reviews", () => {
    const n = computeNotifications(board, { me: "me", settings, notified: new Set(), now });
    expect(n.map((x) => x.id).sort()).toEqual(["review:pr/2", "review:pr/5", "task:t/7", "waiting:d/1"]);
    const w = n.find((x) => x.id === "waiting:d/1")!;
    expect(w).toMatchObject({ kind: "waiting", title: "@alice 在等你回答", body: "要用哪個資料庫？", url: "d/1", projectId: "o/r" });
    expect(n.find((x) => x.id === "task:t/7")).toMatchObject({ kind: "task", body: "寫文件" });
  });

  it("skips already notified ids", () => {
    const n = computeNotifications(board, { me: "me", settings, notified: new Set(["waiting:d/1", "review:pr/2"]), now });
    expect(n.map((x) => x.id).sort()).toEqual(["review:pr/5", "task:t/7"]);
  });

  it("skips disabled kinds", () => {
    const off: AppSettings = { ...settings, notifications: { waiting: false, review: true, task: false } };
    const n = computeNotifications(board, { me: "me", settings: off, notified: new Set(), now });
    expect(n.every((x) => x.kind === "review")).toBe(true);
  });

  it("attentionCount ignores settings and notified", () => {
    expect(attentionCount(board, "me")).toBe(4);
    expect(attentionCount(board, "nobody")).toBe(0);
  });
});
