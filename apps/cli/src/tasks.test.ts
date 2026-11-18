import { describe, expect, it } from "vitest";
import { LABELS } from "@tandem/contracts";
import type { Context } from "./context.ts";
import { createTask } from "./tasks.ts";

describe("createTask", () => {
  it("creates an issue with the task label", async () => {
    const calls: unknown[] = [];
    const gh = { createIssue: async (i: unknown) => (calls.push(i), { number: 3, url: "https://github.com/o/r/issues/3" }) };
    const r = await createTask({ gh: gh as unknown as Context["gh"] }, { title: "t", assign: ["@bob"] });
    expect(r.number).toBe(3);
    expect(calls).toEqual([{ title: "t", body: undefined, assignees: ["bob"], labels: [LABELS.task] }]);
  });
});
