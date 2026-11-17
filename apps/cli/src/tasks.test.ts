import { describe, expect, it } from "vitest";
import { LABELS } from "@tandem/contracts";
import type { Context } from "./context.ts";
import { createTask, parseTaskInput } from "./tasks.ts";

describe("board task input", () => {
  it("trims, strips @ and drops duplicates", () => {
    expect(parseTaskInput({ title: "  做登入頁 ", body: "  ", assign: ["@alice", "alice", "bob"] })).toEqual({
      title: "做登入頁",
      body: undefined,
      assign: ["alice", "bob"],
    });
  });

  it("rejects bad input", () => {
    expect(() => parseTaskInput({ title: " " })).toThrow("標題");
    expect(() => parseTaskInput({ title: "x".repeat(257) })).toThrow("256");
    expect(() => parseTaskInput({ title: "ok", assign: ["not a login"] })).toThrow("GitHub 帳號");
    expect(() => parseTaskInput({ title: "ok", assign: "alice" })).toThrow();
    expect(() => parseTaskInput(null)).toThrow();
  });

  it("creates an issue with the task label", async () => {
    const calls: unknown[] = [];
    const gh = { createIssue: async (i: unknown) => (calls.push(i), { number: 3, url: "https://github.com/o/r/issues/3" }) };
    const r = await createTask({ gh: gh as unknown as Context["gh"] }, { title: "t", assign: ["@bob"] });
    expect(r.number).toBe(3);
    expect(calls).toEqual([{ title: "t", body: undefined, assignees: ["bob"], labels: [LABELS.task] }]);
  });
});
