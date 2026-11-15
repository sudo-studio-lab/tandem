import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PATHS, type DecisionInput } from "@tandem/contracts";
import { checkRecords, createDecision, loadDecisions, slugify } from "./index.ts";
import { put, tempRepo } from "./helpers.test-util.ts";

const input: DecisionInput = {
  title: "Local web first",
  deciders: ["jielle2453"],
  strength: "preference",
  source: "chat",
  quotes: [{ by: "jielle2453", text: "好", source: "chat" }],
  decision: "先做本機網頁。",
  why: "最快。",
};
const now = new Date(2026, 10, 15, 10, 0, 0);
let root: string;
beforeEach(async () => {
  root = await tempRepo();
});

describe("createDecision", () => {
  it("writes the file, creating the folder", async () => {
    const r = await createDecision(root, input, { now });
    expect(r.problems).toEqual([]);
    expect(r.path).toMatch(/^tandem\/decisions\/D-20261115-[0-9a-z]{4}-local-web-first\.md$/);
    expect(await readFile(join(root, r.path), "utf8")).toBe(r.content);
    const loaded = await loadDecisions(root);
    expect(loaded.problems).toEqual([]);
    expect(loaded.decisions[0]!.frontmatter.date).toBe("2026-11-15");
  });
  it("dry run writes nothing", async () => {
    const r = await createDecision(root, input, { now, dryRun: true });
    expect(r.content).toContain("## 決定");
    await expect(readdir(join(root, PATHS.decisions))).rejects.toThrow();
  });
  it("falls back to slug 'decision' for Chinese titles and honours explicit slug", async () => {
    expect(slugify("先做本機網頁")).toBeNull();
    const a = await createDecision(root, { ...input, title: "先做本機網頁" }, { now });
    expect(a.path).toMatch(/-decision\.md$/);
    const b = await createDecision(root, { ...input, title: "先做本機網頁", slug: "local-web" }, { now });
    expect(b.path).toMatch(/-local-web\.md$/);
  });
  it("rejects invalid input without writing", async () => {
    const r = await createDecision(root, { ...input, strength: "bad" as never }, { now });
    expect(r.problems.some((p) => p.severity === "error")).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });
  it("requires quotes or noQuoteBy", async () => {
    const r = await createDecision(root, { ...input, quotes: [] }, { now });
    expect(r.problems[0]!.code).toBe("missing-quotes");
    const ok = await createDecision(root, { ...input, quotes: [], noQuoteBy: "jielle2453" }, { now });
    expect(ok.problems).toEqual([]);
  });
  it("rejects quoting someone else with chat source", async () => {
    const r = await createDecision(root, { ...input, quotes: [{ by: "theroyatlas", text: "x", source: "chat" }] }, { now });
    expect(r.problems.map((p) => p.message).join()).toContain("引用別人必須附網址，或標為轉述");
    await expect(readdir(join(root, PATHS.decisions))).rejects.toThrow();
  });
  it("rejects supersedes of a missing decision, accepts an existing one", async () => {
    const bad = await createDecision(root, { ...input, supersedes: ["D-20260101-aaaa"] }, { now });
    expect(bad.problems.map((p) => p.code)).toContain("supersedes-missing");
    const first = await createDecision(root, input, { now });
    const second = await createDecision(root, { ...input, title: "Second", supersedes: [first.id] }, { now });
    expect(second.problems).toEqual([]);
    const { decisions } = await loadDecisions(root);
    expect(decisions.find((d) => d.frontmatter.id === first.id)!.supersededBy).toEqual([second.id]);
  });
});

describe("loadDecisions", () => {
  it("turns broken files into problems", async () => {
    await put(root, "tandem/decisions/D-20261115-aaaa-bad.md", "garbage");
    await put(root, "tandem/decisions/notes.txt", "ignored");
    const r = await loadDecisions(root);
    expect(r.decisions).toEqual([]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]!.path).toBe("tandem/decisions/D-20261115-aaaa-bad.md");
  });
  it("returns empty when the folder is missing", async () => {
    expect(await loadDecisions(root)).toEqual({ decisions: [], problems: [] });
  });
});

describe("checkRecords", () => {
  it("is clean for good records", async () => {
    await createDecision(root, input, { now });
    expect(await checkRecords(root)).toEqual({ problems: [], fixed: [] });
  });
  it("detects id/filename mismatch and duplicates", async () => {
    const r = await createDecision(root, input, { now });
    const text = await readFile(join(root, r.path), "utf8");
    await put(root, "tandem/decisions/D-20261115-zzzz-other.md", text);
    const c = await checkRecords(root);
    expect(c.problems.map((p) => p.code).sort()).toEqual(["duplicate-id", "id-filename-mismatch"]);
  });
  it("warns when a decision is superseded twice", async () => {
    const a = await createDecision(root, input, { now });
    await createDecision(root, { ...input, title: "b", supersedes: [a.id] }, { now });
    await createDecision(root, { ...input, title: "c", supersedes: [a.id] }, { now });
    const c = await checkRecords(root);
    expect(c.problems.map((p) => [p.code, p.severity])).toEqual([["double-superseded", "warning"]]);
  });
  it("fix renames the later duplicate and rewrites its id", async () => {
    const r = await createDecision(root, input, { now });
    const text = await readFile(join(root, r.path), "utf8");
    const dupName = `${r.id}-zz-copy.md`; // same id, filename sorts later
    await put(root, `tandem/decisions/${dupName}`, text);
    const before = await checkRecords(root);
    const dup = before.problems.filter((p) => p.code === "duplicate-id");
    expect(dup).toHaveLength(1);
    expect(dup[0]!.fixable).toBe(true);
    expect(dup[0]!.path).toBe(`tandem/decisions/${dupName}`);
    const fixed = await checkRecords(root, { fix: true });
    expect(fixed.fixed).toHaveLength(1);
    expect(fixed.problems).toEqual([]);
    const names = (await readdir(join(root, PATHS.decisions))).sort();
    expect(names).toHaveLength(2);
    expect(names).toContain(r.path.split("/").pop());
    expect(names).not.toContain(dupName);
    const { decisions } = await loadDecisions(root);
    expect(new Set(decisions.map((d) => d.frontmatter.id)).size).toBe(2);
  });
  it("includes status problems", async () => {
    await put(root, "tandem/status/jielle2453.md", "nope");
    expect((await checkRecords(root)).problems.map((p) => p.code)).toEqual(["bad-frontmatter"]);
  });
});
