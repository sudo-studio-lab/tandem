/** Tasks are GitHub issues with the task label. Shared by `tandem task` and the MCP tool. */
import { LABELS } from "@tandem/contracts";
import type { Context } from "./context.ts";

export interface TaskInput {
  title: string;
  body?: string;
  assign?: string[];
}

const stripAt = (login: string) => login.trim().replace(/^@/, "");

export function createTask(ctx: Pick<Context, "gh">, input: TaskInput): Promise<{ number: number; url: string }> {
  const assignees = input.assign?.map(stripAt).filter(Boolean);
  return ctx.gh.createIssue({
    title: input.title,
    body: input.body,
    assignees: assignees?.length ? assignees : undefined,
    labels: [LABELS.task],
  });
}
