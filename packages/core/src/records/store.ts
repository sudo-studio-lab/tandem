import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DecisionInput,
  PATHS,
  type Decision,
  type DecisionInput as DecisionInputType,
  type Problem,
} from "@tandem/contracts";
import { dateFromId, generateDecisionId, localDateString, slugify } from "./ids.ts";
import { parseDecision, renderDecision } from "./format.ts";
import { zodProblems } from "./frontmatter.ts";
import { basename, computeSupersededBy, validateDecision, validateDecisionSet } from "./validate.ts";
import { loadStatuses } from "./status.ts";

async function listMarkdown(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith(".md")).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

export async function loadDecisions(repoRoot: string): Promise<{ decisions: Decision[]; problems: Problem[] }> {
  const decisions: Decision[] = [];
  const problems: Problem[] = [];
  for (const name of await listMarkdown(join(repoRoot, PATHS.decisions))) {
    const path = `${PATHS.decisions}/${name}`;
    try {
      const content = await readFile(join(repoRoot, PATHS.decisions, name), "utf8");
      const r = parseDecision(path, content);
      problems.push(...r.problems);
      if (r.decision) decisions.push(r.decision);
    } catch (e) {
      problems.push({ path, severity: "error", code: "unreadable", message: `讀不到檔案：${(e as Error).message}` });
    }
  }
  computeSupersededBy(decisions);
  return { decisions, problems };
}

export interface CreateResult {
  id: string;
  path: string;
  content: string;
  problems: Problem[];
}

export async function createDecision(
  repoRoot: string,
  input: DecisionInputType,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<CreateResult> {
  const now = opts.now ?? new Date();
  const parsed = DecisionInput.safeParse(input);
  if (!parsed.success) return { id: "", path: "", content: "", problems: zodProblems("(輸入)", parsed.error) };
  const p = parsed.data;
  if (p.quotes.length === 0 && !p.noQuoteBy)
    return {
      id: "",
      path: "",
      content: "",
      problems: [
        {
          path: "(輸入)",
          severity: "error",
          code: "missing-quotes",
          message: "要附原話（quotes），或指定 noQuoteBy（沒有原話時由哪位的 agent 整理）",
        },
      ],
    };

  const existing = await loadDecisions(repoRoot);
  const taken = new Set(existing.decisions.map((d) => d.frontmatter.id));
  const id = generateDecisionId(now, (x) => taken.has(x));
  const date = p.date ?? localDateString(now);
  const slug = p.slug ?? slugify(p.title) ?? "decision";
  const path = `${PATHS.decisions}/${id}-${slug}.md`;
  const content = renderDecision(p, id, date);

  const reparsed = parseDecision(path, content);
  const problems = [...reparsed.problems];
  if (reparsed.decision) {
    problems.push(...validateDecision(reparsed.decision));
    problems.push(...validateDecisionSet([...existing.decisions, reparsed.decision]).filter((x) => x.path === path));
  }
  if (problems.some((x) => x.severity === "error")) return { id, path, content, problems };
  if (!opts.dryRun) {
    await mkdir(join(repoRoot, PATHS.decisions), { recursive: true });
    await writeFile(join(repoRoot, path), content, { encoding: "utf8", flag: "wx" });
  }
  return { id, path, content, problems };
}

export async function checkRecords(
  repoRoot: string,
  opts: { fix?: boolean } = {},
): Promise<{ problems: Problem[]; fixed: string[] }> {
  const fixed: string[] = [];
  const run = async () => {
    const { decisions, problems } = await loadDecisions(repoRoot);
    const all = [...problems];
    for (const d of decisions) all.push(...validateDecision(d));
    all.push(...validateDecisionSet(decisions));
    const st = await loadStatuses(repoRoot);
    all.push(...st.problems);
    return { decisions, problems: all };
  };
  let r = await run();
  if (opts.fix) {
    const dupPaths = new Set(r.problems.filter((x) => x.code === "duplicate-id" && x.fixable).map((x) => x.path));
    if (dupPaths.size > 0) {
      const taken = new Set(r.decisions.map((d) => d.frontmatter.id));
      for (const d of r.decisions) {
        if (!dupPaths.has(d.path)) continue;
        const oldId = d.frontmatter.id;
        const newId = generateDecisionId(dateFromId(oldId) ?? new Date(), (x) => taken.has(x));
        taken.add(newId);
        const name = basename(d.path);
        const newName = name.startsWith(`${oldId}-`)
          ? `${newId}${name.slice(oldId.length)}`
          : `${newId}-${slugify(d.frontmatter.title) ?? "decision"}.md`;
        const newPath = `${PATHS.decisions}/${newName}`;
        const text = await readFile(join(repoRoot, d.path), "utf8");
        const rewritten = text.replace(/^(---\r?\n[\s\S]*?^id:[ \t]*).*$/m, `$1${newId}`);
        await rename(join(repoRoot, d.path), join(repoRoot, newPath));
        await writeFile(join(repoRoot, newPath), rewritten, "utf8");
        fixed.push(`${d.path} -> ${newPath}`);
      }
      r = await run();
    }
  }
  return { problems: r.problems, fixed };
}
