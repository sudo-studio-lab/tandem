import { LABELS, WAITING_PREFIX } from "@tandem/contracts";

const WAITING_RE = /^\s*等[：:]\s*(.*)$/;

/** Parse the first line `等：@a @b` (full-width or ASCII colon). Returns [] if absent. */
export function parseWaitingLine(body: string | null | undefined): string[] {
  if (!body) return [];
  const firstLine = body.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const m = WAITING_RE.exec(firstLine);
  if (!m) return [];
  const out: string[] = [];
  for (const mm of (m[1] ?? "").matchAll(/@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/g)) {
    const login = mm[1]!;
    if (!out.includes(login)) out.push(login);
  }
  return out;
}

/** Build the first line of a body; empty string when nobody is waited on. */
export function formatWaitingLine(logins: string[]): string {
  const clean = [...new Set(logins.map((l) => l.replace(/^@/, "")).filter(Boolean))];
  if (clean.length === 0) return "";
  return `${WAITING_PREFIX}${clean.map((l) => `@${l}`).join(" ")}`;
}

export function discussionKindFromLabels(labels: string[]): "question" | "disagreement" | "other" {
  if (labels.includes(LABELS.disagreement)) return "disagreement";
  if (labels.includes(LABELS.question)) return "question";
  return "other";
}

/** Prepend the waiting line (if any) and a blank line to a body. */
export function withWaitingLine(body: string, waitingOn: string[]): string {
  const line = formatWaitingLine(waitingOn);
  return line ? `${line}\n\n${body}` : body;
}
