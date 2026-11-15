import { describe, expect, it } from "vitest";
import { DecisionInput, type DecisionInput as In } from "@tandem/contracts";
import { parseDecision, renderDecision, validateDecision } from "./index.ts";

const base: In = {
  title: "先做本機網頁: 再包桌面版",
  deciders: ["jielle2453"],
  strength: "preference",
  source: "chat",
  quotes: [{ by: "jielle2453", text: "好 那就先做網頁", source: "chat" }],
  decision: "先做本機網頁。",
  why: "最快。",
};
const render = (i: In, id = "D-20261115-k3f9") => renderDecision(DecisionInput.parse(i), id, "2026-11-15");
const keysOf = (out: string) =>
  out
    .split("---")[1]!
    .trim()
    .split("\n")
    .map((l) => l.split(":")[0]);

describe("renderDecision", () => {
  it("orders frontmatter keys and omits empty optionals", () => {
    const out = render(base);
    expect(keysOf(out)).toEqual(["id", "title", "date", "deciders", "strength", "source"]);
    expect(out).toContain("deciders: [jielle2453]");
    expect(out).toContain("> 「好 那就先做網頁」 — @jielle2453（chat）");
    expect(out).not.toContain("考慮過的其他做法");
  });
  it("renders all optional fields in order", () => {
    const out = render({
      ...base,
      consulted: ["theroyatlas"],
      area: "架構",
      supersedes: ["D-20261114-aaaa"],
      optionsConsidered: "桌面版",
      scope: "全部",
    });
    expect(keysOf(out)).toEqual([
      "id",
      "title",
      "date",
      "deciders",
      "consulted",
      "area",
      "strength",
      "source",
      "supersedes",
    ]);
    expect(out.indexOf("## 考慮過的其他做法")).toBeLessThan(out.indexOf("## 適用範圍與什麼時候該重新檢視"));
  });
  it("renders relayed and multi-line quotes", () => {
    const out = render({
      ...base,
      quotes: [
        { by: "theroyatlas", relayedBy: "jielle2453", text: "第一行\n\n第三行", source: "chat" },
        { by: "theroyatlas", text: "b", source: "https://github.com/o/r/discussions/1#c" },
      ],
    });
    expect(out).toContain("> 「第一行\n>\n> 第三行」 — @jielle2453 轉述 @theroyatlas（chat）\n\n> 「b」");
  });
  it("renders the no-quote sentence", () => {
    const out = render({ ...base, quotes: [], noQuoteBy: "jielle2453" });
    expect(out).toContain("## 原話\n\n無原話，由 @jielle2453 的 agent 整理。\n\n## 決定");
  });
  it("throws without quotes and noQuoteBy", () => {
    expect(() => render({ ...base, quotes: [] })).toThrow();
  });
});

describe("parseDecision round trip", () => {
  const cases: Record<string, In> = {
    simple: base,
    full: {
      ...base,
      consulted: ["theroyatlas"],
      area: "架構",
      supersedes: ["D-20261114-aaaa"],
      optionsConsidered: "- 桌面版\n- 雲端版",
      scope: "全部",
      quotes: [
        { by: "jielle2453", text: "含「引號」的話」 — 還有", source: "chat" },
        { by: "theroyatlas", relayedBy: "jielle2453", text: "多行\n\n第三行", source: "chat" },
        { by: "theroyatlas", text: "網址", source: "https://github.com/o/r/discussions/12#discussioncomment-1" },
      ],
    },
    noQuote: { ...base, quotes: [], noQuoteBy: "jielle2453" },
  };
  for (const [name, input] of Object.entries(cases)) {
    it(name, () => {
      const parsedInput = DecisionInput.parse(input);
      const text = renderDecision(parsedInput, "D-20261115-k3f9", "2026-11-15");
      const { decision, problems } = parseDecision("tandem/decisions/D-20261115-k3f9-x.md", text);
      expect(problems).toEqual([]);
      expect(decision!.frontmatter).toMatchObject({
        id: "D-20261115-k3f9",
        title: input.title,
        date: "2026-11-15",
        deciders: input.deciders,
        consulted: parsedInput.consulted,
        ...(input.area ? { area: input.area } : {}),
        strength: "preference",
        source: "chat",
        supersedes: parsedInput.supersedes,
      });
      expect(decision!.quotes).toEqual(parsedInput.quotes);
      expect(decision!.noQuoteBy).toBe(parsedInput.noQuoteBy);
      expect(decision!.decision).toBe(input.decision);
      expect(decision!.why).toBe(input.why);
      expect(decision!.optionsConsidered).toBe(input.optionsConsidered);
      expect(decision!.scope).toBe(input.scope);
      const d = decision!;
      const again = renderDecision(
        DecisionInput.parse({
          title: d.frontmatter.title,
          deciders: d.frontmatter.deciders,
          consulted: d.frontmatter.consulted,
          area: d.frontmatter.area,
          strength: d.frontmatter.strength,
          source: d.frontmatter.source,
          supersedes: d.frontmatter.supersedes,
          quotes: d.quotes,
          noQuoteBy: d.noQuoteBy,
          decision: d.decision,
          why: d.why,
          optionsConsidered: d.optionsConsidered,
          scope: d.scope,
        }),
        "D-20261115-k3f9",
        "2026-11-15",
      );
      expect(again).toBe(text);
    });
  }

  it("accepts stacked quotes without blank lines (data-model example)", () => {
    const text = render(base).replace(
      /> 「好.*\n/,
      "> 「一」 — @jielle2453（chat）\n> 「二」 — @theroyatlas（https://example.com/x）\n",
    );
    const { decision, problems } = parseDecision("tandem/decisions/D-20261115-k3f9-x.md", text);
    expect(problems).toEqual([]);
    expect(decision!.quotes.map((q) => q.text)).toEqual(["一", "二"]);
  });

  it("handles CRLF files", () => {
    const text = render(base).replaceAll("\n", "\r\n");
    expect(parseDecision("tandem/decisions/D-20261115-k3f9-x.md", text).problems).toEqual([]);
  });

  it("reports problems instead of throwing", () => {
    const p = (t: string) => parseDecision("tandem/decisions/x.md", t).problems.map((x) => x.code);
    expect(p("no frontmatter")).toEqual(["bad-frontmatter"]);
    expect(p("---\nid: D-20261115-k3f9\n---\n")).toContain("missing-field");
    expect(p(render(base).replace("strength: preference", "strength: nope"))).toContain("invalid-field");
    expect(p(render(base).replace("## 原因\n\n最快。\n", ""))).toContain("missing-section");
    expect(p(render(base).replace(/> 「.*\n/, "沒有引用格式\n"))).toContain("bad-quote");
    expect(p(render(base).replace(/> 「.*\n/, "> 「沒有人」\n"))).toContain("bad-quote");
    expect(p(render({ ...base, quotes: [], noQuoteBy: "a" }).replace("整理。", "整理，隨便寫。"))).toContain(
      "bad-no-quote",
    );
  });
});

describe("validateDecision", () => {
  const load = (i: In, path = "tandem/decisions/D-20261115-k3f9-x.md") => parseDecision(path, render(i)).decision!;
  it("passes a clean decision", () => expect(validateDecision(load(base))).toEqual([]));
  it("requires quotes of others to have a URL or be relayed", () => {
    const probs = validateDecision(load({ ...base, quotes: [{ by: "theroyatlas", text: "x", source: "chat" }] }));
    expect(probs).toHaveLength(1);
    expect(probs[0]!.message).toContain("引用別人必須附網址，或標為轉述");
    const ok = (q: In["quotes"]) => validateDecision(load({ ...base, quotes: q }));
    expect(ok([{ by: "theroyatlas", text: "x", source: "https://e.com/a" }])).toEqual([]);
    expect(ok([{ by: "theroyatlas", relayedBy: "jielle2453", text: "x", source: "chat" }])).toEqual([]);
    expect(
      validateDecision(
        load({ ...base, deciders: ["jielle2453", "theroyatlas"], quotes: [{ by: "theroyatlas", text: "x", source: "chat" }] }),
      ),
    ).toEqual([]);
  });
  it("checks filename prefix", () => {
    const d = load(base, "tandem/decisions/D-20261115-zzzz-x.md");
    expect(validateDecision(d).map((p) => p.code)).toEqual(["id-filename-mismatch"]);
    expect(validateDecision(load(base, "tandem/decisions/D-20261115-k3f9.md")).map((p) => p.code)).toEqual([
      "id-filename-mismatch",
    ]);
  });
});
