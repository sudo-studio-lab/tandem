import { parse, Document, visit, isScalar } from "yaml";
import type { ZodError } from "zod";
import type { Problem } from "@tandem/contracts";

export function normalizeNewlines(s: string): string {
  return s.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

export type SplitResult =
  | { ok: true; data: Record<string, unknown>; body: string; raw: string }
  | { ok: false; message: string };

export function splitFrontmatter(content: string): SplitResult {
  const text = normalizeNewlines(content);
  const m = /^---\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { ok: false, message: "找不到檔案開頭的 frontmatter（---）" };
  let data: unknown;
  try {
    data = parse(m[1] ?? "");
  } catch (e) {
    return { ok: false, message: `frontmatter 不是合法的 YAML：${(e as Error).message.split("\n")[0]}` };
  }
  if (data === null || data === undefined) data = {};
  if (typeof data !== "object" || Array.isArray(data)) return { ok: false, message: "frontmatter 必須是欄位清單" };
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) if (v !== null) clean[k] = v;
  return { ok: true, data: clean, body: text.slice(m[0].length), raw: m[1] ?? "" };
}

/** Stringify to YAML frontmatter block (with --- fences), scalar lists in flow style. */
export function stringifyFrontmatter(obj: Record<string, unknown>): string {
  const doc = new Document(obj);
  visit(doc, {
    Seq(_key, node) {
      if (node.items.every((i) => isScalar(i))) node.flow = true;
    },
  });
  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  return `---\n${yaml}---\n`;
}

export function zodProblems(path: string, error: ZodError): Problem[] {
  return error.issues.map((issue) => {
    const field = issue.path.join(".") || "(根)";
    const missing = /received undefined/.test(issue.message);
    return {
      path,
      severity: "error" as const,
      code: missing ? "missing-field" : "invalid-field",
      message: missing ? `缺少必填欄位「${field}」` : `欄位「${field}」不正確：${issue.message}`,
    };
  });
}

/** Split a markdown body into `## heading` sections (fence-aware). Text before the first heading is returned as `preamble`. */
export function parseSections(body: string): { sections: Map<string, string>; order: string[]; preamble: string } {
  const sections = new Map<string, string>();
  const order: string[] = [];
  const buf: string[] = [];
  let current: string | null = null;
  let preamble = "";
  let fence = false;
  const flush = () => {
    const text = buf.join("\n").trim();
    if (current === null) preamble = text;
    else if (!sections.has(current)) {
      sections.set(current, text);
      order.push(current);
    }
    buf.length = 0;
  };
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence ? /^## +(.+?)\s*$/.exec(line) : null;
    if (h) {
      flush();
      current = h[1]!;
    } else buf.push(line);
  }
  flush();
  return { sections, order, preamble };
}
