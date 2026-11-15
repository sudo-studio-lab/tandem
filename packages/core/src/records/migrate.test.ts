import { cp, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkRecords, loadDecisions, loadStatuses, migrateLegacyRecords } from "./index.ts";
import { put, tempRepo } from "./helpers.test-util.ts";

const realRepo = resolve(fileURLToPath(import.meta.url), "../../../../..");
const now = new Date(2026, 10, 15, 16, 0, 0);

describe("migrateLegacyRecords on the real repo (dry run)", () => {
  it("converts every legacy decision with no errors", async () => {
    const legacy = (await readdir(join(realRepo, "records/decisions"))).filter((n) => n.endsWith(".md"));
    expect(legacy.length).toBeGreaterThan(10);
    const r = await migrateLegacyRecords(realRepo, { dryRun: true, now });
    expect(r.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(r.decisions).toHaveLength(legacy.length);
    expect(r.statuses).toHaveLength(1);
    expect(new Set(r.decisions.map((d) => d.to)).size).toBe(legacy.length);
    for (const d of r.decisions) expect(d.to).toMatch(/^tandem\/decisions\/D-20261115-[0-9a-z]{4}-.+\.md$/);
  });

  it("round-trips through the validator when written to a temp copy", async () => {
    const root = await tempRepo();
    await cp(join(realRepo, "records"), join(root, "records"), { recursive: true });
    await cp(join(realRepo, "team"), join(root, "team"), { recursive: true });
    const r = await migrateLegacyRecords(root, { now });
    expect(r.problems.filter((p) => p.severity === "error")).toEqual([]);
    const check = await checkRecords(root);
    expect(check.problems.filter((p) => p.severity === "error")).toEqual([]);
    const { decisions } = await loadDecisions(root);
    expect(decisions).toHaveLength(r.decisions.length);

    const by = (frag: string) => decisions.find((d) => d.path.includes(frag))!;
    const full = by("build-full-then-adjust");
    const dogfood = by("dogfood");
    expect(full.frontmatter.supersedes).toEqual([dogfood.frontmatter.id]);
    expect(dogfood.supersededBy).toEqual([full.frontmatter.id]);
    for (const d of decisions) expect([...d.frontmatter.title].length).toBeLessThanOrEqual(40);
    expect(by("target-users").frontmatter.deciders).toEqual(["jielle2453"]);
    expect(by("target-users").frontmatter.source).toBe("chat");
    const adaptive = by("adaptive-not-hardcoded");
    expect(adaptive.quotes[0]).toMatchObject({ by: "theroyatlas", relayedBy: "jielle2453", source: "chat" });
    const c71 = by("records-direct-to-main");
    expect(c71.noQuoteBy).toBe("jielle2453");
    expect(c71.quotes).toEqual([]);
    expect(c71.why.startsWith("Claude 提議後，@jielle2453 回「好」")).toBe(true);
    expect(by("borrow-gh-login").frontmatter.id).toBe("D-20261115-w7m2");
    const st = (await loadStatuses(root)).statuses[0]!;
    expect(st.login).toBe("jielle2453");
    expect(st.doing).toContain("Tandem 核心的 spec");
    expect(st.blocked).toContain("Q-20261115-3a5");
    expect(st.deliverables[0]!.url).toBe("https://github.com/sudo-studio-lab/tandem");
    expect(st.fyi).toHaveLength(3);
    expect(await readFile(join(root, "team/status/jielle2453.md"), "utf8")).toContain("user: jielle2453");
  });
});

describe("migrateLegacyRecords edge cases", () => {
  const legacy = (owner: string, quote: string) => `---
id: D-20261115-abc
status: active
area: 測試
owner: ${owner}
strength: hard
date: 2026-11-15
supersedes:
---

## 原話

${quote}

## 決定

第一句很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長，第二句。

## 原因

因為。

## 適用範圍與什麼時候該重新檢視

總是。
`;
  it("handles documents without URLs, chat quotes from non-deciders, and long titles", async () => {
    const root = await tempRepo();
    await put(root, "records/decisions/D-20261115-abc-doc.md", legacy("jielle2453", "> 「文件內容」 — @theroyatlas（README 文件）"));
    await put(root, "records/decisions/D-20261115-abd-chat.md", legacy("jielle2453", "> 「他說的」 — @theroyatlas（與 Claude 的討論）"));
    await put(
      root,
      "records/decisions/D-20261115-abe-url.md",
      legacy("jielle2453", "> 「有網址」 — @theroyatlas（https://github.com/o/r/discussions/1#c）"),
    );
    const r = await migrateLegacyRecords(root, { now });
    expect(r.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(r.problems.map((p) => p.code).sort()).toEqual(["legacy-quote-relayed", "legacy-quoter-added"]);
    const { decisions } = await loadDecisions(root);
    const doc = decisions.find((d) => d.path.endsWith("-doc.md"))!;
    expect(doc.quotes[0]).toMatchObject({ by: "theroyatlas", relayedBy: "jielle2453" });
    const chat = decisions.find((d) => d.path.endsWith("-chat.md"))!;
    expect(chat.frontmatter.deciders).toEqual(["jielle2453", "theroyatlas"]);
    const url = decisions.find((d) => d.path.endsWith("-url.md"))!;
    expect(url.quotes[0]!.source).toBe("https://github.com/o/r/discussions/1#c");
    expect([...url.frontmatter.title].length).toBeLessThanOrEqual(40);
    expect(url.frontmatter.title.endsWith("，")).toBe(false);
    expect(url.decision).toContain("第二句。");
  });
  it("reports unknown supersedes and unparseable quotes as errors", async () => {
    const root = await tempRepo();
    await put(
      root,
      "records/decisions/D-20261115-abc-x.md",
      legacy("a", "> 壞掉的引用").replace("supersedes:", "supersedes: D-20200101-fff"),
    );
    const r = await migrateLegacyRecords(root, { dryRun: true, now });
    expect(r.problems.map((p) => p.code)).toContain("legacy-bad-quote");
    expect(r.decisions).toEqual([]);
  });
  it("does nothing when there are no legacy records", async () => {
    const root = await tempRepo();
    expect(await migrateLegacyRecords(root, { now })).toEqual({ decisions: [], statuses: [], problems: [] });
  });
});
