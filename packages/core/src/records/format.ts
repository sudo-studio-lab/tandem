import {
  DECISION_SECTIONS,
  DecisionFrontmatter,
  type Decision,
  type DecisionInputParsed,
  type Problem,
  type Quote,
} from "@tandem/contracts";
import { Source as SourceSchema } from "@tandem/contracts";
import { parseSections, splitFrontmatter, stringifyFrontmatter, zodProblems } from "./frontmatter.ts";

export function noQuoteSentence(login: string): string {
  return `無原話，由 @${login} 的 agent 整理。`;
}

export function renderQuote(q: Quote): string {
  const who = q.relayedBy ? `@${q.relayedBy} 轉述 @${q.by}` : `@${q.by}`;
  const text = `「${q.text}」 — ${who}（${q.source}）`;
  return text
    .split("\n")
    .map((l) => (l === "" ? ">" : `> ${l}`))
    .join("\n");
}

export function renderDecision(input: DecisionInputParsed, id: string, date: string): string {
  const fm: Record<string, unknown> = {
    id,
    title: input.title,
    date,
    deciders: input.deciders,
  };
  if (input.consulted.length > 0) fm.consulted = input.consulted;
  if (input.area !== undefined && input.area !== "") fm.area = input.area;
  fm.strength = input.strength;
  fm.source = input.source;
  if (input.supersedes.length > 0) fm.supersedes = input.supersedes;

  let quotesBlock: string;
  if (input.quotes.length > 0) quotesBlock = input.quotes.map(renderQuote).join("\n\n");
  else if (input.noQuoteBy) quotesBlock = noQuoteSentence(input.noQuoteBy);
  else throw new Error("沒有原話時必須指定 noQuoteBy");

  const parts: string[] = [
    `## ${DECISION_SECTIONS.quotes}\n\n${quotesBlock}`,
    `## ${DECISION_SECTIONS.decision}\n\n${input.decision.trim()}`,
    `## ${DECISION_SECTIONS.why}\n\n${input.why.trim()}`,
  ];
  if (input.optionsConsidered?.trim()) parts.push(`## ${DECISION_SECTIONS.optionsConsidered}\n\n${input.optionsConsidered.trim()}`);
  if (input.scope?.trim()) parts.push(`## ${DECISION_SECTIONS.scope}\n\n${input.scope.trim()}`);
  return `${stringifyFrontmatter(fm)}\n${parts.join("\n\n")}\n`;
}


/** Parse the 原話 section. */
function parseQuotesSection(
  path: string,
  text: string,
): { quotes: Quote[]; noQuoteBy?: string; problems: Problem[] } {
  const problems: Problem[] = [];
  const err = (code: string, message: string) => problems.push({ path, severity: "error", code, message });
  const noQuote = /^無原話，由 @([A-Za-z0-9-]+) 的 agent 整理。$/.exec(text.trim());
  if (noQuote) return { quotes: [], noQuoteBy: noQuote[1]!, problems };
  if (text.trim() === "") {
    err("missing-quotes", "「原話」區是空的：要附原話，或寫「無原話，由 @帳號 的 agent 整理。」");
    return { quotes: [], problems };
  }
  if (/^無原話/.test(text.trim())) {
    err("bad-no-quote", "沒有原話時，內容必須剛好是「無原話，由 @帳號 的 agent 整理。」");
    return { quotes: [], problems };
  }
  const quotes: Quote[] = [];
  const blocks = text.split(/\n[ \t]*\n/);
  for (const block of blocks) {
    const lines = block.split("\n");
    if (!lines.every((l) => /^>/.test(l))) {
      err("bad-quote", "原話必須是引用格式：> 「原話」 — @帳號（出處）");
      continue;
    }
    const joined = lines.map((l) => l.replace(/^> ?/, "")).join("\n");
    // Several quotes may be stacked in one block; split after each footer.
    let rest = joined;
    while (rest.trim() !== "") {
      const m = /^「([\s\S]*?)」 — @([A-Za-z0-9-]+)(?: 轉述 @([A-Za-z0-9-]+))?（([^）]*)）(?:\n|$)/.exec(rest.trimStart());
      if (!m) {
        err("bad-quote", `每則原話都要有 @帳號 和出處：> 「原話」 — @帳號（chat 或網址）`);
        break;
      }
      const src = SourceSchema.safeParse(m[4]);
      if (!src.success) err("bad-quote-source", `原話出處必須是 chat 或網址，但這則是「${m[4]}」`);
      else {
        const q: Quote = m[3]
          ? { by: m[3], relayedBy: m[2]!, text: m[1]!, source: src.data }
          : { by: m[2]!, text: m[1]!, source: src.data };
        quotes.push(q);
      }
      rest = rest.trimStart().slice(m[0].length);
    }
  }
  return { quotes, problems };
}

export function parseDecision(path: string, content: string): { decision?: Decision; problems: Problem[] } {
  const problems: Problem[] = [];
  const split = splitFrontmatter(content);
  if (!split.ok) return { problems: [{ path, severity: "error", code: "bad-frontmatter", message: split.message }] };
  const fm = DecisionFrontmatter.safeParse(split.data);
  if (!fm.success) problems.push(...zodProblems(path, fm.error));

  const { sections, order } = parseSections(split.body);
  const S = DECISION_SECTIONS;
  const known = new Set<string>(Object.values(S));
  for (const h of order)
    if (!known.has(h)) problems.push({ path, severity: "warning", code: "unknown-section", message: `不認得的段落「${h}」` });

  const need = (name: string) => {
    const v = sections.get(name);
    if (v === undefined || v === "") {
      problems.push({ path, severity: "error", code: "missing-section", message: `缺少「${name}」段落` });
      return "";
    }
    return v;
  };

  let quotes: Quote[] = [];
  let noQuoteBy: string | undefined;
  const q = sections.get(S.quotes);
  if (q === undefined) problems.push({ path, severity: "error", code: "missing-section", message: `缺少「${S.quotes}」段落` });
  else {
    const r = parseQuotesSection(path, q);
    quotes = r.quotes;
    noQuoteBy = r.noQuoteBy;
    problems.push(...r.problems);
  }
  const decision = need(S.decision);
  const why = need(S.why);
  const opt = sections.get(S.optionsConsidered);
  const scope = sections.get(S.scope);

  if (!fm.success || problems.some((p) => p.severity === "error")) return { problems };
  const d: Decision = {
    frontmatter: fm.data,
    path,
    quotes,
    decision,
    why,
    supersededBy: [],
  };
  if (noQuoteBy) d.noQuoteBy = noQuoteBy;
  if (opt) d.optionsConsidered = opt;
  if (scope) d.scope = scope;
  return { decision: d, problems };
}
