import type { Decision, Problem } from "@tandem/contracts";

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Rules that look at a single decision (data-model.md rules 1-6, minus cross-file ones). */
export function validateDecision(d: Decision): Problem[] {
  const problems: Problem[] = [];
  const add = (code: string, message: string) => problems.push({ path: d.path, severity: "error", code, message });
  const id = d.frontmatter.id;
  const name = basename(d.path);
  if (!name.startsWith(`${id}-`) || !name.endsWith(".md") || name.length <= id.length + 4)
    add("id-filename-mismatch", `檔名必須是「${id}-<英文名稱>.md」，目前是「${name}」`);

  if (d.quotes.length === 0 && !d.noQuoteBy)
    add("missing-quotes", "沒有原話時，內容必須是「無原話，由 @帳號 的 agent 整理。」");
  const deciders = new Set(d.frontmatter.deciders);
  d.quotes.forEach((q, i) => {
    if (!deciders.has(q.by) && q.source === "chat" && !q.relayedBy)
      add("quote-needs-source", `第 ${i + 1} 則原話：引用別人必須附網址，或標為轉述（@${q.by}）`);
  });
  if (d.frontmatter.supersedes.includes(id)) add("self-supersede", "決定不能取代自己");
  return problems;
}

/** Rules across files: duplicate ids, supersedes targets, double supersession. */
export function validateDecisionSet(decisions: Decision[]): Problem[] {
  const problems: Problem[] = [];
  const byId = new Map<string, Decision[]>();
  for (const d of decisions) {
    const list = byId.get(d.frontmatter.id) ?? [];
    list.push(d);
    byId.set(d.frontmatter.id, list);
  }
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const d of sorted.slice(1))
      problems.push({
        path: d.path,
        severity: "error",
        code: "duplicate-id",
        message: `編號 ${id} 和「${sorted[0]!.path}」重複（可用 --fix 改號）`,
        fixable: true,
      });
  }
  const supersededBy = new Map<string, Set<string>>();
  for (const d of decisions) {
    for (const target of d.frontmatter.supersedes) {
      if (!byId.has(target))
        problems.push({
          path: d.path,
          severity: "error",
          code: "supersedes-missing",
          message: `取代的決定 ${target} 不存在`,
        });
      else if (target !== d.frontmatter.id) {
        const s = supersededBy.get(target) ?? new Set<string>();
        s.add(d.frontmatter.id);
        supersededBy.set(target, s);
      }
    }
  }
  for (const [target, by] of supersededBy) {
    if (by.size < 2) continue;
    for (const t of byId.get(target)!)
      problems.push({
        path: t.path,
        severity: "warning",
        code: "double-superseded",
        message: `${target} 同時被 ${[...by].join("、")} 取代，兩個人可能意見不同`,
      });
  }
  return problems;
}

export function computeSupersededBy(decisions: Decision[]): void {
  const map = new Map<string, string[]>();
  for (const d of decisions)
    for (const t of d.frontmatter.supersedes) {
      const l = map.get(t) ?? [];
      if (!l.includes(d.frontmatter.id)) l.push(d.frontmatter.id);
      map.set(t, l);
    }
  for (const d of decisions) d.supersededBy = map.get(d.frontmatter.id) ?? [];
}
