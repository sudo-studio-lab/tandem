import { describe, expect, it } from "vitest";
import { DecisionInput, DECISION_ID_RE, StatusFrontmatter } from "./index.ts";

describe("contracts", () => {
  it("accepts a valid decision input", () => {
    const r = DecisionInput.safeParse({
      title: "先做本機網頁",
      deciders: ["jielle2453"],
      strength: "preference",
      source: "chat",
      quotes: [{ by: "jielle2453", text: "好", source: "chat" }],
      decision: "x",
      why: "y",
    });
    expect(r.success).toBe(true);
  });
  it("id format", () => {
    expect(DECISION_ID_RE.test("D-20261115-k3f9")).toBe(true);
    expect(DECISION_ID_RE.test("D-20261115-a3f")).toBe(false);
  });
  it("status defaults", () => {
    const s = StatusFrontmatter.parse({ login: "jielle2453", updated: "2026-11-15T10:00:00+08:00" });
    expect(s.fyi).toEqual([]);
    expect(s.blocked).toBe("");
  });
});
