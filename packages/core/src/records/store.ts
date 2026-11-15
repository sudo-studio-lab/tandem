import {
  DecisionInput,
  PATHS,
  type Decision,
  type DecisionInput as DecisionInputType,
  type Problem,
} from "@tandem/contracts";
import { openFsDataStore, type DataStore, type FileChange, type WriteResult } from "../data/index.ts";
import { dateFromId, generateDecisionId, localDateString, slugify } from "./ids.ts";
import { parseDecision, renderDecision } from "./format.ts";
import { zodProblems } from "./frontmatter.ts";
import { basename, computeSupersededBy, validateDecision, validateDecisionSet } from "./validate.ts";
import { loadStatuses } from "./status.ts";

/** A string means a plain folder (existing callers); a DataStore is used as is. */
export function asStore(store: DataStore | string): DataStore {
  return typeof store === "string" ? openFsDataStore(store) : store;
}

/** Read many files with a small concurrency cap (each read may spawn a git process). */
export async function readMany(store: DataStore, paths: string[]): Promise<(string | null | Error)[]> {
  const out: (string | null | Error)[] = new Array<string | null | Error>(paths.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= paths.length) return;
      out[i] = await store.read(paths[i]!).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, paths.length) }, worker));
  return out;
}

export async function loadDecisions(
  storeOrRoot: DataStore | string,
): Promise<{ decisions: Decision[]; problems: Problem[] }> {
  const store = asStore(storeOrRoot);
  const decisions: Decision[] = [];
  const problems: Problem[] = [];
  const paths = (await store.list("decisions")).map((n) => `${PATHS.decisions}/${n}`);
  const contents = await readMany(store, paths);
  paths.forEach((path, i) => {
    const content = contents[i];
    if (content === null || content === undefined || content instanceof Error) {
      problems.push({
        path,
        severity: "error",
        code: "unreadable",
        message: `讀不到檔案：${content instanceof Error ? content.message : "檔案不存在"}`,
      });
      return;
    }
    const r = parseDecision(path, content);
    problems.push(...r.problems);
    if (r.decision) decisions.push(r.decision);
  });
  computeSupersededBy(decisions);
  return { decisions, problems };
}

export interface CreateResult {
  id: string;
  path: string;
  content: string;
  problems: Problem[];
  /** Result of writing through the store (absent for dry runs and invalid input). */
  write?: WriteResult;
}

export async function createDecision(
  storeOrRoot: DataStore | string,
  input: DecisionInputType,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<CreateResult> {
  const store = asStore(storeOrRoot);
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

  const existing = await loadDecisions(store);
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
  if (opts.dryRun) return { id, path, content, problems };
  const write = await store.write([{ path, content, createOnly: true }], `tandem: add decision ${id}`);
  return { id, path, content, problems, write };
}

export async function checkRecords(
  storeOrRoot: DataStore | string,
  opts: { fix?: boolean } = {},
): Promise<{ problems: Problem[]; fixed: string[] }> {
  const store = asStore(storeOrRoot);
  const fixed: string[] = [];
  const run = async () => {
    const { decisions, problems } = await loadDecisions(store);
    const all = [...problems];
    for (const d of decisions) all.push(...validateDecision(d));
    all.push(...validateDecisionSet(decisions));
    const st = await loadStatuses(store);
    all.push(...st.problems);
    return { decisions, problems: all };
  };
  let r = await run();
  if (opts.fix) {
    const dupPaths = new Set(r.problems.filter((x) => x.code === "duplicate-id" && x.fixable).map((x) => x.path));
    if (dupPaths.size > 0) {
      const taken = new Set(r.decisions.map((d) => d.frontmatter.id));
      const changes: FileChange[] = [];
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
        const text = (await store.read(d.path)) ?? "";
        const rewritten = text.replace(/^(---\r?\n[\s\S]*?^id:[ \t]*).*$/m, `$1${newId}`);
        changes.push({ path: d.path, content: null }, { path: newPath, content: rewritten });
        fixed.push(`${d.path} -> ${newPath}`);
      }
      await store.write(changes, "tandem: fix duplicate decision ids");
      r = await run();
    }
  }
  return { problems: r.problems, fixed };
}
