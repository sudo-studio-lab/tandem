import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DECISION_ID_RE,
  DecisionInput,
  GitHubLogin,
  PATHS,
  StatusFrontmatter,
  type Decision,
  type DecisionInputParsed,
  type Problem,
  type Quote,
} from "@tandem/contracts";
import { dateFromId, generateDecisionId, localDateString, localIsoString } from "./ids.ts";
import { parseSections, splitFrontmatter } from "./frontmatter.ts";
import { parseDecision, renderDecision } from "./format.ts";
import { loadDecisions } from "./store.ts";
import { parseStatus, renderStatus } from "./status.ts";
import { validateDecision, validateDecisionSet } from "./validate.ts";

const LEGACY_DECISIONS = "records/decisions";
const LEGACY_STATUS = "team/status";

export interface MigrationResult {
  decisions: { from: string; to: string }[];
  statuses: { from: string; to: string }[];
  problems: Problem[];
}

async function listMd(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function firstSentenceTitle(decision: string): string {
  const firstLine = decision.trim().split("\n")[0] ?? "";
  const m = /^(.*?)(?:[。！？!?]|\.(?:\s|$)|$)/.exec(firstLine);
  let s = (m?.[1] ?? firstLine).trim();
  const strip = (x: string) => x.replace(/[\s，、；：:;,.。！？!?]+$/u, "");
  s = strip(s);
  const chars = [...s];
  if (chars.length > 40) s = strip(chars.slice(0, 40).join(""));
  return s;
}

const LEGACY_FOOTER = /^「([\s\S]*)」 — @([A-Za-z0-9-]+)(?: 轉述 @([A-Za-z0-9-]+)[^（]*)?（([\s\S]*)）\s*$/;

function sourceFromNote(note: string): { source: string; isDocument: boolean } {
  const url = /https?:\/\/[^\s）)」]+/.exec(note);
  if (url) return { source: url[0], isDocument: false };
  return { source: "chat", isDocument: /文件|文檔|檔案|README|\.md|網頁|文章/.test(note) };
}

function asList(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return String(v)
    .split(/[\s,，]+/)
    .filter(Boolean);
}

export async function migrateLegacyRecords(
  repoRoot: string,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<MigrationResult> {
  const now = opts.now ?? new Date();
  const result: MigrationResult = { decisions: [], statuses: [], problems: [] };
  const warn = (path: string, code: string, message: string, severity: "error" | "warning" = "warning") =>
    result.problems.push({ path, severity, code, message });

  const existing = await loadDecisions(repoRoot);
  const taken = new Set(existing.decisions.map((d) => d.frontmatter.id));

  // Pass 1: assign new ids.
  const legacyNames = await listMd(join(repoRoot, LEGACY_DECISIONS));
  const idMap = new Map<string, string>();
  const entries: { name: string; path: string; oldId: string; slug: string; newId: string }[] = [];
  for (const name of legacyNames) {
    const path = `${LEGACY_DECISIONS}/${name}`;
    const m = /^(D-\d{8}-[0-9a-z]+)-(.+)\.md$/.exec(name);
    if (!m) {
      warn(path, "legacy-bad-filename", "舊檔名不是 D-YYYYMMDD-xxx-slug.md，無法遷移", "error");
      continue;
    }
    const oldId = m[1]!;
    let newId = oldId;
    if (!DECISION_ID_RE.test(oldId)) {
      newId = generateDecisionId(dateFromId(oldId) ?? now, (x) => taken.has(x));
    }
    taken.add(newId);
    idMap.set(oldId, newId);
    entries.push({ name, path, oldId, slug: m[2]!, newId });
  }
  const remapText = (s: string) => s.replace(/D-\d{8}-[0-9a-f]{3,4}\b/g, (x) => idMap.get(x) ?? x);
  const optional = (s: string | undefined) => (s === undefined ? undefined : remapText(s));

  // Pass 2: convert decisions.
  const converted: { entry: (typeof entries)[number]; toPath: string; content: string }[] = [];
  for (const e of entries) {
    const text = await readFile(join(repoRoot, e.path), "utf8");
    const split = splitFrontmatter(text);
    if (!split.ok) {
      warn(e.path, "legacy-bad-frontmatter", split.message, "error");
      continue;
    }
    const fm = split.data;
    const { sections } = parseSections(split.body);
    const owner = String(fm.owner ?? "");
    if (!GitHubLogin.safeParse(owner).success) {
      warn(e.path, "legacy-bad-owner", `owner「${owner}」不是合法的 GitHub 帳號`, "error");
      continue;
    }
    const deciders = [owner];
    const extraWhy: string[] = [];
    const quotes: Quote[] = [];
    let noQuoteBy: string | undefined;

    const quoteText = sections.get("原話") ?? "";
    for (const para of quoteText.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean)) {
      const nq = /^無原話，由 @([A-Za-z0-9-]+) 的 agent(?:（[^）]*）)?整理。/.exec(para);
      if (nq) {
        noQuoteBy = nq[1]!;
        const rest = para.slice(nq[0].length).trim();
        if (rest) extraWhy.push(rest);
        continue;
      }
      if (para.startsWith(">")) {
        const joined = para
          .split("\n")
          .map((l) => l.replace(/^> ?/, ""))
          .join("\n");
        const m = LEGACY_FOOTER.exec(joined);
        if (!m) {
          warn(e.path, "legacy-bad-quote", `看不懂這則原話的格式：${para.slice(0, 40)}`, "error");
          continue;
        }
        const { source, isDocument } = sourceFromNote(m[4]!);
        const q: Quote = m[3]
          ? { by: m[3], relayedBy: m[2]!, text: m[1]!, source: source as Quote["source"] }
          : { by: m[2]!, text: m[1]!, source: source as Quote["source"] };
        if (!q.relayedBy && !deciders.includes(q.by) && source === "chat") {
          if (isDocument) {
            q.relayedBy = owner;
            warn(e.path, "legacy-quote-relayed", `@${q.by} 的原話來自沒有網址的文件，已標為由 @${owner} 轉述`);
          } else {
            deciders.push(q.by);
            warn(e.path, "legacy-quoter-added", `@${q.by} 在對話中說的話被引用，已把 @${q.by} 加入 deciders`);
          }
        }
        quotes.push(q);
        continue;
      }
      extraWhy.push(para);
    }
    if (quotes.length === 0 && !noQuoteBy) {
      warn(e.path, "legacy-no-quotes", "舊紀錄沒有原話也沒有「無原話」說明", "error");
      continue;
    }

    const decision = sections.get("決定") ?? "";
    const why = [...extraWhy, sections.get("原因") ?? ""].filter((s) => s !== "").join("\n\n");
    const supersedes = asList(fm.supersedes).map((o) => {
      const n = idMap.get(o);
      if (!n) warn(e.path, "legacy-supersedes-unknown", `取代的 ${o} 找不到對應的新編號`, "error");
      return n ?? o;
    });
    const date = typeof fm.date === "string" ? fm.date : (dateFromId(e.oldId) ? localDateString(dateFromId(e.oldId)!) : localDateString(now));
    const input: DecisionInputParsed = DecisionInput.parse({
      title: firstSentenceTitle(decision) || e.slug,
      deciders,
      area: typeof fm.area === "string" && fm.area ? fm.area : undefined,
      strength: fm.strength,
      source: "chat",
      quotes,
      noQuoteBy,
      // Remap old ids in our own prose; quotes stay verbatim.
      decision: remapText(decision),
      why: remapText(why || "（舊紀錄沒有寫原因）"),
      optionsConsidered: optional(sections.get("考慮過的其他做法")),
      scope: optional(sections.get("適用範圍與什麼時候該重新檢視")),
      supersedes,
    });
    for (const h of sections.keys())
      if (!["原話", "決定", "原因", "考慮過的其他做法", "適用範圍與什麼時候該重新檢視"].includes(h))
        warn(e.path, "legacy-unmapped-section", `段落「${h}」沒有對應的新欄位，未遷移`);
    const toPath = `${PATHS.decisions}/${e.newId}-${e.slug}.md`;
    converted.push({ entry: e, toPath, content: renderDecision(input, e.newId, date) });
  }

  // Validate the outputs as a set (together with anything already in tandem/decisions).
  const parsed: Decision[] = [];
  for (const c of converted) {
    const r = parseDecision(c.toPath, c.content);
    result.problems.push(...r.problems);
    if (r.decision) {
      parsed.push(r.decision);
      result.problems.push(...validateDecision(r.decision));
    }
  }
  const newPaths = new Set(parsed.map((d) => d.path));
  result.problems.push(...validateDecisionSet([...existing.decisions, ...parsed]).filter((p) => newPaths.has(p.path)));

  for (const c of converted) {
    if (!opts.dryRun) {
      await mkdir(join(repoRoot, PATHS.decisions), { recursive: true });
      try {
        await writeFile(join(repoRoot, c.toPath), c.content, { encoding: "utf8", flag: "wx" });
      } catch (err) {
        warn(c.toPath, "target-exists", `無法寫入：${(err as Error).message}`, "error");
        continue;
      }
    }
    result.decisions.push({ from: c.entry.path, to: c.toPath });
  }

  // Statuses.
  for (const name of await listMd(join(repoRoot, LEGACY_STATUS))) {
    const from = `${LEGACY_STATUS}/${name}`;
    const text = await readFile(join(repoRoot, from), "utf8");
    const split = splitFrontmatter(text);
    if (!split.ok) {
      warn(from, "legacy-bad-frontmatter", split.message, "error");
      continue;
    }
    const login = String(split.data.user ?? split.data.login ?? name.replace(/\.md$/, ""));
    if (!GitHubLogin.safeParse(login).success) {
      warn(from, "legacy-bad-login", `「${login}」不是合法的 GitHub 帳號`, "error");
      continue;
    }
    const { sections, preamble } = parseSections(split.body);
    const bullets = (s: string) =>
      s
        .split("\n")
        .map((l) => /^\s*[-*] +(.*)$/.exec(l)?.[1]?.trim())
        .filter((x): x is string => !!x);
    const oneLine = (s: string) => remapText(s.replace(/\s*\n\s*/g, " ").trim());
    let doing = "";
    let next = "";
    let blocked = "";
    const fyi: { text: string; ref?: string }[] = [];
    const deliverables: { title: string; url: string }[] = [];
    const notes: string[] = [];
    if (preamble) notes.push(preamble);
    for (const [heading, body] of sections) {
      if (/正在做|進行中/.test(heading)) doing = oneLine(body);
      else if (/下一步|接下來/.test(heading)) next = oneLine(body);
      else if (/卡在|在等/.test(heading)) {
        const items = bullets(body);
        blocked = remapText(items.length > 0 ? items.join("；") : body.trim());
        if (/^(無|沒有|none)[。.]?$/i.test(blocked)) blocked = "";
      } else if (/剛完成/.test(heading)) {
        const rest: string[] = [];
        for (const b of bullets(body)) {
          const u = /^(.*?)[：:]?\s*(https?:\/\/\S+)\s*$/.exec(b);
          if (u && deliverables.length < 5) deliverables.push({ title: u[1]!.trim() || u[2]!, url: u[2]! });
          else rest.push(b);
        }
        if (rest.length > 0) notes.push(`${heading}\n\n${rest.map((r) => `- ${remapText(r)}`).join("\n")}`);
      } else if (/知道/.test(heading)) {
        const rest: string[] = [];
        for (const b of bullets(body)) {
          if (fyi.length < 3) {
            const text = remapText(b);
            const ref = /D-\d{8}-[0-9a-z]{4}/.exec(text)?.[0];
            fyi.push(ref ? { text, ref } : { text });
          } else rest.push(b);
        }
        if (rest.length > 0) notes.push(`${heading}\n\n${rest.map((r) => `- ${remapText(r)}`).join("\n")}`);
      } else notes.push(`${heading}\n\n${remapText(body)}`);
    }
    const fm = StatusFrontmatter.parse({ login, updated: localIsoString(now), doing, next, blocked, fyi, deliverables });
    const content = renderStatus({ ...fm, notes: notes.join("\n\n") });
    const toPath = `${PATHS.status}/${login}.md`;
    const check = parseStatus(toPath, content);
    result.problems.push(...check.problems);
    if (!opts.dryRun) {
      if (await exists(join(repoRoot, toPath))) {
        warn(toPath, "target-exists", "新的狀態檔已存在，未覆寫", "error");
        continue;
      }
      await mkdir(join(repoRoot, PATHS.status), { recursive: true });
      await writeFile(join(repoRoot, toPath), content, "utf8");
    }
    result.statuses.push({ from, to: toPath });
  }
  return result;
}
