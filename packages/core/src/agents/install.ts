import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PRODUCT, TandemError } from "@tandem/contracts";
import { SKILLS, renderSkill, skillDirName } from "./skills.ts";
import {
  BLOCK_RE,
  CLAUDE_MD_BLOCK,
  CLAUDE_MD_BLOCK_RE,
  CLAUDE_MD_CREATED,
  buildBlock,
  detectEol,
  toEol,
} from "./text.ts";

export interface Change {
  path: string;
  action: "create" | "update" | "unchanged";
  note?: string;
}

export interface CheckItem {
  item: string;
  path: string;
  state: "missing" | "stale" | "current";
  note?: string;
}

const C = PRODUCT.command;
const HOOK_PREFIX = `${C} hook `;
const BOM = "﻿";

// ---------------------------------------------------------------------------
// File plumbing: plan pure changes first, then apply.
// ---------------------------------------------------------------------------
interface Op {
  rel: string;
  before: string | null;
  /** null = delete the file. */
  after: string | null;
  note?: string;
  /** For skills: remove the whole folder on delete. */
  removeDir?: string;
}

async function readText(repoRoot: string, rel: string): Promise<string | null> {
  try {
    return await readFile(join(repoRoot, rel), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function toChange(op: Op): Change {
  const c: Change =
    op.before === op.after
      ? { path: op.rel, action: "unchanged" }
      : op.before === null
        ? { path: op.rel, action: "create" }
        : { path: op.rel, action: "update" };
  if (op.note && c.action !== "unchanged") c.note = op.note;
  else if (op.after === null && op.before !== null) c.note = op.note ?? "已刪除";
  return c;
}

async function apply(repoRoot: string, ops: Op[], dryRun: boolean): Promise<Change[]> {
  const changes = ops.map(toChange);
  if (dryRun) return changes;
  for (const op of ops) {
    if (op.before === op.after) continue;
    const abs = join(repoRoot, op.rel);
    if (op.after === null) {
      if (op.removeDir) await rm(join(repoRoot, op.removeDir), { recursive: true, force: true });
      else await rm(abs, { force: true });
    } else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, op.after, "utf8");
    }
  }
  return changes;
}

async function pruneEmptyDirs(repoRoot: string): Promise<void> {
  for (const d of [".claude/skills", ".claude", ".agents/skills", ".agents", ".codex"]) {
    try {
      await rmdir(join(repoRoot, d)); // only succeeds when empty
    } catch {
      /* not empty or absent */
    }
  }
}

function splitBom(text: string): [string, string] {
  return text.startsWith(BOM) ? [BOM, text.slice(1)] : ["", text];
}

// ---------------------------------------------------------------------------
// AGENTS.md
// ---------------------------------------------------------------------------
const AGENTS_MD = "AGENTS.md";

function planAgentsInstall(before: string | null): Op {
  if (before === null) return { rel: AGENTS_MD, before, after: buildBlock() + "\n" };
  const [bom, text] = splitBom(before);
  const eol = detectEol(text);
  const block = toEol(buildBlock(), eol);
  let after: string;
  if (BLOCK_RE.test(text)) after = text.replace(BLOCK_RE, () => block);
  else after = text.length === 0 ? block + eol : block + eol + eol + text;
  return { rel: AGENTS_MD, before, after: bom + after };
}

function planAgentsRemove(before: string | null): Op {
  if (before === null) return { rel: AGENTS_MD, before, after: null };
  const [bom, text] = splitBom(before);
  const m = BLOCK_RE.exec(text);
  if (!m) return { rel: AGENTS_MD, before, after: before };
  const start = m.index;
  let end = start + m[0].length;
  const rest = text.slice(end);
  const eolM = /^(\r?\n)(\r?\n)?/.exec(rest);
  if (eolM) end += start === 0 ? eolM[0].length : eolM[1]!.length;
  const after = text.slice(0, start) + text.slice(end);
  if (after.trim() === "") return { rel: AGENTS_MD, before, after: null };
  return { rel: AGENTS_MD, before, after: bom + after };
}

// ---------------------------------------------------------------------------
// CLAUDE.md
// ---------------------------------------------------------------------------
const CLAUDE_MD = "CLAUDE.md";
const IMPORT_LINE_RE = /^@AGENTS\.md[ \t]*$/m;

function planClaudeMdInstall(before: string | null): Op {
  if (before === null) return { rel: CLAUDE_MD, before, after: CLAUDE_MD_CREATED };
  const [bom, text] = splitBom(before);
  if (IMPORT_LINE_RE.test(text)) return { rel: CLAUDE_MD, before, after: before };
  return { rel: CLAUDE_MD, before, after: bom + toEol(CLAUDE_MD_BLOCK, detectEol(text)) + text };
}

function planClaudeMdRemove(before: string | null): Op {
  if (before === null) return { rel: CLAUDE_MD, before, after: null };
  if (before === CLAUDE_MD_CREATED) return { rel: CLAUDE_MD, before, after: null };
  const [bom, text] = splitBom(before);
  if (!CLAUDE_MD_BLOCK_RE.test(text)) return { rel: CLAUDE_MD, before, after: before };
  return { rel: CLAUDE_MD, before, after: bom + text.replace(CLAUDE_MD_BLOCK_RE, "") };
}

// ---------------------------------------------------------------------------
// Hook config files (.claude/settings.json, .codex/hooks.json)
// Shapes verified against:
//   https://code.claude.com/docs/en/hooks   (event -> [{matcher?, hooks:[{type,command,timeout}]}])
//   https://learn.chatgpt.com/docs/hooks    (same shape; optional commandWindows; Stop/UserPromptSubmit ignore matcher)
// ---------------------------------------------------------------------------
interface HookSpec {
  event: string;
  matcher?: string;
  command: string;
  commandWindows?: string;
  timeout: number;
}

type Json = Record<string, unknown>;

function claudeSpecs(): HookSpec[] {
  return [
    { event: "SessionStart", matcher: "startup|resume|clear|compact", command: `${C} hook session-start --agent claude`, timeout: 30 },
    { event: "Stop", command: `${C} hook stop --agent claude`, timeout: 30 },
  ];
}

function codexSpecs(): HookSpec[] {
  const s = (event: string, hook: string, matcher?: string): HookSpec => {
    const command = `${C} hook ${hook} --agent codex`;
    return { event, ...(matcher ? { matcher } : {}), command, commandWindows: command, timeout: 30 };
  };
  return [
    s("SessionStart", "session-start", "startup|resume|clear"),
    s("Stop", "stop"),
    s("PostCompact", "post-compact"),
    s("UserPromptSubmit", "user-prompt"),
  ];
}

const CLAUDE_SETTINGS = ".claude/settings.json";
const CODEX_HOOKS = ".codex/hooks.json";

interface Entry {
  matcher?: string;
  hook: Json;
}

function isObj(v: unknown): v is Json {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

function isTandemHook(h: unknown): boolean {
  return isObj(h) && typeof h.command === "string" && h.command.startsWith(HOOK_PREFIX);
}

function specEntry(spec: HookSpec): Entry {
  const hook: Json = { type: "command", command: spec.command };
  if (spec.commandWindows) hook.commandWindows = spec.commandWindows;
  hook.timeout = spec.timeout;
  return spec.matcher ? { matcher: spec.matcher, hook } : { hook };
}

function tandemEntries(hooks: Json, event: string): Entry[] {
  const groups = hooks[event];
  const out: Entry[] = [];
  if (!Array.isArray(groups)) return out;
  for (const g of groups) {
    if (!isObj(g) || !Array.isArray(g.hooks)) continue;
    for (const h of g.hooks) {
      if (isTandemHook(h)) {
        out.push({ ...(typeof g.matcher === "string" ? { matcher: g.matcher } : {}), hook: h as Json });
      }
    }
  }
  return out;
}

/** Remove Tandem hooks from one event; drops groups/events that become empty because of this. */
function stripEvent(hooks: Json, event: string): boolean {
  const groups = hooks[event];
  if (!Array.isArray(groups)) return false;
  let touched = false;
  const kept: unknown[] = [];
  for (const g of groups) {
    if (isObj(g) && Array.isArray(g.hooks) && g.hooks.some(isTandemHook)) {
      touched = true;
      const rest = g.hooks.filter((h) => !isTandemHook(h));
      if (rest.length > 0) kept.push({ ...g, hooks: rest });
    } else kept.push(g);
  }
  if (!touched) return false;
  if (kept.length > 0) hooks[event] = kept;
  else delete hooks[event];
  return true;
}

function parseJsonFile(rel: string, text: string): Json {
  let v: unknown;
  try {
    v = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    throw new TandemError("validation", `${rel} 不是有效的 JSON，請先修正再執行：${(e as Error).message}`);
  }
  if (!isObj(v)) throw new TandemError("validation", `${rel} 的最外層必須是 JSON 物件`);
  if (v.hooks !== undefined && !isObj(v.hooks)) throw new TandemError("validation", `${rel} 的 "hooks" 必須是物件`);
  return v;
}

function serializeJson(obj: Json, before: string | null): string {
  let indent: string | number = 2;
  let eol: "\n" | "\r\n" = "\n";
  let trailing = true;
  let bom = "";
  if (before !== null) {
    const [b, text] = splitBom(before);
    bom = b;
    const m = /^([ \t]+)"/m.exec(text);
    if (m) indent = m[1]!.includes("\t") ? "\t" : m[1]!.length;
    eol = detectEol(text);
    trailing = /\n$/.test(text);
  }
  let out = JSON.stringify(obj, null, indent);
  if (eol === "\r\n") out = out.replace(/\n/g, "\r\n");
  return bom + out + (trailing ? eol : "");
}

function planHooksInstall(rel: string, before: string | null, specs: HookSpec[]): Op {
  const base: Json = before === null ? {} : parseJsonFile(rel, before);
  const next = structuredClone(base);
  const hooks: Json = isObj(next.hooks) ? next.hooks : {};
  const desiredByEvent = new Map<string, Entry[]>();
  for (const s of specs) desiredByEvent.set(s.event, [...(desiredByEvent.get(s.event) ?? []), specEntry(s)]);

  // Tandem entries in events we no longer write (e.g. from an older version) are removed too.
  for (const event of Object.keys(hooks)) {
    if (!desiredByEvent.has(event)) stripEvent(hooks, event);
  }
  for (const [event, desired] of desiredByEvent) {
    if (deepEqual(tandemEntries(hooks, event), desired)) continue;
    stripEvent(hooks, event);
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    for (const e of desired) groups.push(e.matcher ? { matcher: e.matcher, hooks: [e.hook] } : { hooks: [e.hook] });
    hooks[event] = groups;
  }
  next.hooks = hooks;
  if (deepEqual(next, base) && before !== null) return { rel, before, after: before };
  return { rel, before, after: serializeJson(next, before) };
}

function planHooksRemove(rel: string, before: string | null): Op {
  if (before === null) return { rel, before, after: null };
  let base: Json;
  try {
    base = parseJsonFile(rel, before);
  } catch {
    return { rel, before, after: before, note: "無法解析，沒有動" };
  }
  const next = structuredClone(base);
  if (isObj(next.hooks)) {
    let touched = false;
    for (const event of Object.keys(next.hooks)) touched = stripEvent(next.hooks, event) || touched;
    if (touched && Object.keys(next.hooks).length === 0) delete next.hooks;
  }
  if (deepEqual(next, base)) return { rel, before, after: before };
  if (Object.keys(next).length === 0) return { rel, before, after: null };
  return { rel, before, after: serializeJson(next, before) };
}

// ---------------------------------------------------------------------------
// MCP registration (spec 003 FR-002): project files only, never the user's global config.
//   Claude Code: .mcp.json  {"mcpServers": {"tandem": {"command", "args"}}}
//     (verified 2026-11-15 on Windows: a bare "tandem" resolves to tandem.cmd, no `cmd /c` needed)
//   Codex: .codex/config.toml  [mcp_servers.tandem]  (only read when the project is trusted)
// ---------------------------------------------------------------------------
const MCP_JSON = ".mcp.json";
const CODEX_CONFIG = ".codex/config.toml";
const MCP_NAME = PRODUCT.command;

function mcpEntry(): Json {
  return { command: C, args: ["mcp"] };
}

function parseMcpJson(text: string): Json {
  const v = parseJsonFile(MCP_JSON, text);
  if (v.mcpServers !== undefined && !isObj(v.mcpServers)) {
    throw new TandemError("validation", `${MCP_JSON} 的 "mcpServers" 必須是物件`);
  }
  return v;
}

function planMcpJsonInstall(before: string | null): Op {
  const base: Json = before === null ? {} : parseMcpJson(before);
  const servers: Json = isObj(base.mcpServers) ? base.mcpServers : {};
  if (deepEqual(servers[MCP_NAME], mcpEntry()) && before !== null) return { rel: MCP_JSON, before, after: before };
  const next = structuredClone(base);
  next.mcpServers = { ...servers, [MCP_NAME]: mcpEntry() };
  return { rel: MCP_JSON, before, after: serializeJson(next, before) };
}

function planMcpJsonRemove(before: string | null): Op {
  if (before === null) return { rel: MCP_JSON, before, after: null };
  let base: Json;
  try {
    base = parseMcpJson(before);
  } catch {
    return { rel: MCP_JSON, before, after: before, note: "無法解析，沒有動" };
  }
  if (!isObj(base.mcpServers) || !(MCP_NAME in base.mcpServers)) return { rel: MCP_JSON, before, after: before };
  const next = structuredClone(base);
  const servers = next.mcpServers as Json;
  delete servers[MCP_NAME];
  if (Object.keys(servers).length === 0) delete next.mcpServers;
  if (Object.keys(next).length === 0) return { rel: MCP_JSON, before, after: null };
  return { rel: MCP_JSON, before, after: serializeJson(next, before) };
}

const TOML_BEGIN = `# BEGIN ${PRODUCT.markerName}`;
const TOML_END = `# END ${PRODUCT.markerName}`;
const TOML_BLOCK_RE = new RegExp(`^${TOML_BEGIN}[^\\n]*\\r?\\n[\\s\\S]*?^${TOML_END}[ \\t]*$`, "m");
/** A [mcp_servers.tandem] table the user wrote themselves (outside our block). */
const TOML_OWN_TABLE_RE = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*"?${MCP_NAME}"?\\s*\\]`, "m");

function codexBlock(): string {
  return [
    `${TOML_BEGIN}（由 ${C} init 管理，不要手動改）`,
    `[mcp_servers.${MCP_NAME}]`,
    `command = "${C}"`,
    `args = ["mcp"]`,
    TOML_END,
  ].join("\n");
}

function planCodexConfigInstall(before: string | null): Op {
  if (before === null) return { rel: CODEX_CONFIG, before, after: codexBlock() + "\n" };
  const [bom, text] = splitBom(before);
  const eol = detectEol(text);
  const block = toEol(codexBlock(), eol);
  if (TOML_BLOCK_RE.test(text)) return { rel: CODEX_CONFIG, before, after: bom + text.replace(TOML_BLOCK_RE, () => block) };
  if (TOML_OWN_TABLE_RE.test(text)) {
    return { rel: CODEX_CONFIG, before, after: before, note: `已經有自己的 [mcp_servers.${MCP_NAME}]，沒有動` };
  }
  // Appended at the end: our block starts with a table header, so it can't capture the user's keys.
  const sep = text.length === 0 ? "" : text.endsWith("\n") ? eol : eol + eol;
  return { rel: CODEX_CONFIG, before, after: bom + text + sep + block + eol };
}

function planCodexConfigRemove(before: string | null): Op {
  if (before === null) return { rel: CODEX_CONFIG, before, after: null };
  const [bom, text] = splitBom(before);
  const m = TOML_BLOCK_RE.exec(text);
  if (!m) return { rel: CODEX_CONFIG, before, after: before };
  let end = m.index + m[0].length;
  const eolM = /^\r?\n/.exec(text.slice(end));
  if (eolM) end += eolM[0].length;
  const after = (text.slice(0, m.index) + text.slice(end)).replace(/(\r?\n)(\r?\n)+$/, "$1");
  if (after.trim() === "") return { rel: CODEX_CONFIG, before, after: null };
  return { rel: CODEX_CONFIG, before, after: bom + after };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
const SKILL_ROOTS = [".claude/skills", ".agents/skills"];

function skillPaths(): { rel: string; dir: string; text: string }[] {
  const out: { rel: string; dir: string; text: string }[] = [];
  for (const root of SKILL_ROOTS) {
    for (const def of SKILLS) {
      const dir = `${root}/${skillDirName(def)}`;
      out.push({ rel: `${dir}/SKILL.md`, dir, text: renderSkill(def) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function installAgentIntegration(repoRoot: string, opts: { dryRun?: boolean } = {}): Promise<Change[]> {
  const ops: Op[] = [];
  // Parse hook files first so a broken JSON file fails before anything is written.
  const settings = await readText(repoRoot, CLAUDE_SETTINGS);
  const codex = await readText(repoRoot, CODEX_HOOKS);
  const settingsOp = planHooksInstall(CLAUDE_SETTINGS, settings, claudeSpecs());
  const codexOp = planHooksInstall(CODEX_HOOKS, codex, codexSpecs());
  const mcpOp = planMcpJsonInstall(await readText(repoRoot, MCP_JSON));

  ops.push(planAgentsInstall(await readText(repoRoot, AGENTS_MD)));
  ops.push(planClaudeMdInstall(await readText(repoRoot, CLAUDE_MD)));
  ops.push(settingsOp, codexOp, mcpOp);
  ops.push(planCodexConfigInstall(await readText(repoRoot, CODEX_CONFIG)));
  for (const s of skillPaths()) ops.push({ rel: s.rel, before: await readText(repoRoot, s.rel), after: s.text });
  return apply(repoRoot, ops, opts.dryRun === true);
}

export async function removeAgentIntegration(repoRoot: string, opts: { dryRun?: boolean } = {}): Promise<Change[]> {
  const ops: Op[] = [];
  ops.push(planAgentsRemove(await readText(repoRoot, AGENTS_MD)));
  ops.push(planClaudeMdRemove(await readText(repoRoot, CLAUDE_MD)));
  ops.push(planHooksRemove(CLAUDE_SETTINGS, await readText(repoRoot, CLAUDE_SETTINGS)));
  ops.push(planHooksRemove(CODEX_HOOKS, await readText(repoRoot, CODEX_HOOKS)));
  ops.push(planMcpJsonRemove(await readText(repoRoot, MCP_JSON)));
  ops.push(planCodexConfigRemove(await readText(repoRoot, CODEX_CONFIG)));
  for (const s of skillPaths()) {
    const before = await readText(repoRoot, s.rel);
    ops.push({ rel: s.rel, before, after: null, removeDir: s.dir });
  }
  const dryRun = opts.dryRun === true;
  // A missing file is "unchanged" for removal; the generic converter would call before:null/after:null equal.
  const changes = await apply(repoRoot, ops, dryRun);
  if (!dryRun) await pruneEmptyDirs(repoRoot);
  return changes;
}

export async function checkAgentIntegration(repoRoot: string): Promise<CheckItem[]> {
  const items: CheckItem[] = [];

  const agents = await readText(repoRoot, AGENTS_MD);
  {
    const item = "AGENTS.md 管理區塊";
    if (agents === null || !BLOCK_RE.test(agents)) {
      items.push({ item, path: AGENTS_MD, state: "missing" });
    } else {
      const found = BLOCK_RE.exec(agents.replace(/\r\n/g, "\n"))![0];
      if (found === buildBlock()) items.push({ item, path: AGENTS_MD, state: "current" });
      else items.push({ item, path: AGENTS_MD, state: "stale", note: "版本或內容和目前的不同" });
    }
  }

  const claudeMd = await readText(repoRoot, CLAUDE_MD);
  items.push({
    item: "CLAUDE.md 引用 AGENTS.md",
    path: CLAUDE_MD,
    state: claudeMd !== null && IMPORT_LINE_RE.test(claudeMd) ? "current" : "missing",
  });

  const hookFiles: [string, string, HookSpec[]][] = [
    ["Claude Code", CLAUDE_SETTINGS, claudeSpecs()],
    ["Codex", CODEX_HOOKS, codexSpecs()],
  ];
  for (const [label, rel, specs] of hookFiles) {
    const text = await readText(repoRoot, rel);
    let hooks: Json = {};
    let parseNote: string | undefined;
    if (text !== null) {
      try {
        const parsed = parseJsonFile(rel, text);
        hooks = isObj(parsed.hooks) ? parsed.hooks : {};
      } catch (e) {
        parseNote = (e as Error).message;
      }
    }
    for (const spec of specs) {
      const item = `${label} hook ${spec.event}`;
      if (parseNote) {
        items.push({ item, path: rel, state: "stale", note: parseNote });
        continue;
      }
      const existing = tandemEntries(hooks, spec.event);
      if (existing.length === 0) items.push({ item, path: rel, state: "missing" });
      else if (deepEqual(existing, [specEntry(spec)])) items.push({ item, path: rel, state: "current" });
      else items.push({ item, path: rel, state: "stale", note: "設定和目前的不同" });
    }
  }

  {
    const item = "Claude Code MCP";
    const text = await readText(repoRoot, MCP_JSON);
    let state: CheckItem["state"] = "missing";
    let note: string | undefined;
    if (text !== null) {
      try {
        const parsed = parseMcpJson(text);
        const entry = isObj(parsed.mcpServers) ? parsed.mcpServers[MCP_NAME] : undefined;
        if (entry === undefined) state = "missing";
        else if (deepEqual(entry, mcpEntry())) state = "current";
        else [state, note] = ["stale", "設定和目前的不同"];
      } catch (e) {
        [state, note] = ["stale", (e as Error).message];
      }
    }
    items.push({ item, path: MCP_JSON, state, ...(note ? { note } : {}) });
  }
  {
    const item = "Codex MCP";
    const text = await readText(repoRoot, CODEX_CONFIG);
    const norm = text?.replace(/\r\n/g, "\n") ?? null;
    const m = norm === null ? null : TOML_BLOCK_RE.exec(norm);
    if (m) items.push({ item, path: CODEX_CONFIG, ...(m[0] === codexBlock() ? { state: "current" as const } : { state: "stale" as const, note: "設定和目前的不同" }) });
    else if (norm !== null && TOML_OWN_TABLE_RE.test(norm)) items.push({ item, path: CODEX_CONFIG, state: "current", note: "使用者自己的設定" });
    else items.push({ item, path: CODEX_CONFIG, state: "missing" });
  }

  for (const s of skillPaths()) {
    const text = await readText(repoRoot, s.rel);
    const item = `技能 ${s.dir.split("/").pop()}（${s.dir.split("/")[0]}）`;
    if (text === null) items.push({ item, path: s.rel, state: "missing" });
    else if (text.replace(/\r\n/g, "\n") === s.text) items.push({ item, path: s.rel, state: "current" });
    else items.push({ item, path: s.rel, state: "stale", note: "版本標記或內容不同" });
  }
  return items;
}
