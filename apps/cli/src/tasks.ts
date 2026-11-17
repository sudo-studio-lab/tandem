/** Tasks are GitHub issues with the task label. Shared by `tandem task`, the MCP tool and the local server. */
import { LABELS, TandemError } from "@tandem/contracts";
import type { Context } from "./context.ts";

export interface TaskInput {
  title: string;
  body?: string;
  assign?: string[];
}

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const TITLE_MAX = 256;

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

/** Validate untrusted input (the board's form). Throws a usage error with a message the user can act on. */
export function parseTaskInput(raw: unknown): TaskInput {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) throw new TandemError("usage", "請輸入任務標題");
  if (title.length > TITLE_MAX) throw new TandemError("usage", `標題最多 ${TITLE_MAX} 個字`);
  if (b.body !== undefined && typeof b.body !== "string") throw new TandemError("usage", "說明格式不正確");
  const body = typeof b.body === "string" && b.body.trim() ? b.body : undefined;
  if (b.assign !== undefined && (!Array.isArray(b.assign) || b.assign.some((x) => typeof x !== "string"))) {
    throw new TandemError("usage", "指派對象格式不正確");
  }
  const assign = ((b.assign as string[] | undefined) ?? []).map(stripAt);
  const bad = assign.find((l) => !LOGIN.test(l));
  if (bad !== undefined) throw new TandemError("usage", `「${bad}」不是正確的 GitHub 帳號`);
  return { title, body, assign: assign.length ? [...new Set(assign)] : undefined };
}
