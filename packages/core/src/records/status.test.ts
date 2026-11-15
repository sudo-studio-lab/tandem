import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { StatusFrontmatter } from "@tandem/contracts";
import { loadStatuses, parseStatus, renderStatus, updateStatus } from "./index.ts";
import { put, tempRepo } from "./helpers.test-util.ts";

let root: string;
beforeEach(async () => {
  root = await tempRepo();
});
const now = new Date(2026, 10, 15, 16, 0, 0);

describe("status render/parse", () => {
  it("round-trips", () => {
    const fm = StatusFrontmatter.parse({
      login: "jielle2453",
      updated: "2026-11-15T14:30:00+08:00",
      doing: "寫 spec: 第一版",
      next: "實作",
      blocked: "",
      fyi: [{ text: "一", ref: "D-20261115-5f1a" }, { text: "二" }],
      deliverables: [{ title: "spec", url: "https://github.com/a/b/blob/main/x.md" }],
    });
    const text = renderStatus({ ...fm, notes: "自由文字\n第二行" });
    expect(text.startsWith("---\nlogin: jielle2453\nupdated: 2026-11-15T14:30:00+08:00\n")).toBe(true);
    const r = parseStatus("tandem/status/jielle2453.md", text);
    expect(r.problems).toEqual([]);
    expect(r.status).toEqual({ ...fm, path: "tandem/status/jielle2453.md", notes: "自由文字\n第二行" });
    expect(renderStatus(r.status!)).toBe(text);
  });
  it("flags login/filename mismatch and bad frontmatter", () => {
    const text = renderStatus(StatusFrontmatter.parse({ login: "a", updated: "x" }));
    expect(parseStatus("tandem/status/b.md", text).problems[0]!.code).toBe("status-login-mismatch");
    expect(parseStatus("tandem/status/b.md", "---\nlogin: 5\n---\n").problems.length).toBeGreaterThan(0);
  });
});

describe("updateStatus", () => {
  it("creates a new file with an offset timestamp", async () => {
    const r = await updateStatus(root, "jielle2453", { doing: "寫程式" }, { now });
    expect(r.path).toBe("tandem/status/jielle2453.md");
    expect(r.status.updated).toMatch(/^2026-11-15T16:00:00[+-]\d{2}:\d{2}$/);
    expect((await loadStatuses(root)).statuses[0]!.doing).toBe("寫程式");
  });
  it("merges patches and keeps untouched fields", async () => {
    await updateStatus(root, "jielle2453", { doing: "A", next: "B", notes: "memo", fyi: [{ text: "x" }] }, { now });
    const r = await updateStatus(root, "jielle2453", { doing: "C", blocked: "卡住" }, { now });
    expect(r.status).toMatchObject({ doing: "C", next: "B", blocked: "卡住", notes: "memo", fyi: [{ text: "x" }] });
    const r2 = await updateStatus(root, "jielle2453", { blocked: "" }, { now });
    expect(r2.status.blocked).toBe("");
  });
  it("dry run does not write", async () => {
    const r = await updateStatus(root, "jielle2453", { doing: "A" }, { now, dryRun: true });
    expect(r.content).toContain("doing: A");
    expect((await loadStatuses(root)).statuses).toEqual([]);
  });
  it("refuses another person's file and bad logins", async () => {
    await put(
      root,
      "tandem/status/jielle2453.md",
      renderStatus(StatusFrontmatter.parse({ login: "theroyatlas", updated: "x" })),
    );
    await expect(updateStatus(root, "jielle2453", { doing: "x" }, { now })).rejects.toThrow(/只能更新自己/);
    await expect(updateStatus(root, "../evil", { doing: "x" }, { now })).rejects.toThrow();
    const content = await readFile(join(root, "tandem/status/jielle2453.md"), "utf8");
    expect(content).toContain("login: theroyatlas");
  });
  it("validates limits (fyi max 3)", async () => {
    const fyi = [1, 2, 3, 4].map((n) => ({ text: String(n) }));
    await expect(updateStatus(root, "jielle2453", { fyi }, { now })).rejects.toThrow();
  });
});
