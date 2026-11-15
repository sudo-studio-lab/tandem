import { describe, expect, it } from "vitest";
import { dateFromId, generateDecisionId, localIsoString, slugify } from "./index.ts";
import { DECISION_ID_RE } from "@tandem/contracts";

describe("generateDecisionId", () => {
  it("uses local date and 4 base36 chars", () => {
    const id = generateDecisionId(new Date(2026, 10, 5, 23, 59), () => false);
    expect(id).toMatch(DECISION_ID_RE);
    expect(id.startsWith("D-20261105-")).toBe(true);
  });
  it("retries on collision", () => {
    let calls = 0;
    const id = generateDecisionId(new Date(2026, 0, 2), () => ++calls < 5);
    expect(calls).toBe(5);
    expect(id).toMatch(DECISION_ID_RE);
  });
  it("dateFromId round trips", () => {
    const d = dateFromId("D-20261115-abcd")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 10, 15]);
  });
});

describe("slugify", () => {
  it("makes ascii slugs", () => {
    expect(slugify("Local Web First!")).toBe("local-web-first");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
  });
  it("returns null when nothing usable", () => {
    expect(slugify("先做本機網頁")).toBeNull();
    expect(slugify("  ")).toBeNull();
  });
  it("keeps the ascii part of mixed titles", () => {
    expect(slugify("先做 gh 登入")).toBe("gh");
  });
});

describe("localIsoString", () => {
  it("has an offset", () => {
    expect(localIsoString(new Date(2026, 10, 15, 16, 0, 0))).toMatch(/^2026-11-15T16:00:00[+-]\d{2}:\d{2}$/);
  });
});
