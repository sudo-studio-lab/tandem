/** Command implementations. */
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  LABELS,
  PRODUCT,
  StatusPatch,
  TandemError,
  type DecisionInput,
  type Problem,
} from "@tandem/contracts";
import {
  checkAgentIntegration,
  checkRecords,
  createDecision,
  createDiscussionOrIssue,
  getGitHubToken,
  loadAppState,
  renderBrief,
  syncData,
  updateStatus,
  type WriteResult,
} from "@tandem/core";
import { openContext, withTimeout, type Context } from "./context.ts";
import { buildBrief, gatherGitHub } from "./gather.ts";
import { info, printJson, readJsonInput } from "./io.ts";
import { joinProject, rememberProject, setupProject } from "./setup.ts";

interface JsonOpt {
  json?: boolean;
}

/** Tell the user where a record write ended up. */
function reportWrite(w: WriteResult | undefined): void {
  if (!w || w.result === "pushed") return;
  if (w.result === "conflict") info(`⚠ 已經有同名的紀錄，這筆沒有寫入：${(w.conflicts ?? []).join("、")}`);
  else info(`⚠ 紀錄先存在這台電腦，連上網後會自動同步${w.message ? `（${w.message}）` : ""}`);
}

function printProblems(problems: Problem[]): void {
  for (const p of problems) info(`${p.severity === "error" ? "✗" : "!"} ${p.path}：${p.message}`);
}

// ---------------------------------------------------------------------------
// brief
// ---------------------------------------------------------------------------
export async function cmdBrief(opts: JsonOpt & { peek?: boolean }): Promise<void> {
  const ctx = await openContext();
  await syncData(ctx.repoRoot, { gitEnv: ctx.gitEnv }).catch(() => undefined);
  const gh = await withTimeout(gatherGitHub(ctx), 15_000, null);
  const { brief, head } = await buildBrief(ctx, gh);
  if (opts.json) printJson(brief);
  else process.stdout.write(`${renderBrief(brief)}\n`);
  if (!opts.peek) {
    ctx.state.lastBrief = { commit: head, time: new Date().toISOString() };
  }
  await ctx.saveState();
}

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------
export async function cmdDecide(
  opts: JsonOpt & {
    input?: string;
    dryRun?: boolean;
    sync?: boolean;
    title?: string;
    decision?: string;
    why?: string;
    strength?: string;
    source?: string;
    area?: string;
    slug?: string;
    quote?: string;
    supersedes?: string[];
  },
): Promise<void> {
  const ctx = await openContext();
  let raw: Record<string, unknown>;
  if (opts.input) {
    const parsed = await readJsonInput(opts.input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TandemError("usage", "--input 必須是一個 JSON 物件");
    raw = parsed as Record<string, unknown>;
  } else {
    if (!opts.title || !opts.decision || !opts.why) {
      throw new TandemError("usage", "請用 --input 提供 JSON，或至少給 --title、--decision、--why");
    }
    raw = {
      title: opts.title,
      decision: opts.decision,
      why: opts.why,
      strength: opts.strength ?? "preference",
      source: opts.source ?? "chat",
      area: opts.area,
      slug: opts.slug,
      supersedes: opts.supersedes ?? [],
      quotes: opts.quote ? [{ by: ctx.me, text: opts.quote, source: opts.source ?? "chat" }] : [],
      noQuoteBy: opts.quote ? undefined : ctx.me,
    };
  }
  raw.deciders ??= [ctx.me];
  raw.strength ??= "preference";
  raw.source ??= "chat";
  if ((!Array.isArray(raw.quotes) || raw.quotes.length === 0) && raw.noQuoteBy === undefined) raw.noQuoteBy = ctx.me;

  const result = await createDecision(ctx.store, raw as DecisionInput, { dryRun: opts.dryRun });
  const errors = result.problems.filter((p) => p.severity === "error");
  if (opts.json) printJson({ ...result, written: !opts.dryRun && errors.length === 0 });
  else if (errors.length === 0) {
    if (opts.dryRun) process.stdout.write(`${result.content}\n`);
    else info(`已記錄 ${result.id}：${result.path}`);
  }
  printProblems(result.problems);
  if (errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  if (!opts.dryRun) reportWrite(result.write);
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
export { collect };

export async function cmdStatus(
  opts: JsonOpt & {
    input?: string;
    doing?: string;
    next?: string;
    blocked?: string;
    fyi?: string[];
    deliverable?: string[];
    notes?: string;
    dryRun?: boolean;
    sync?: boolean;
  },
): Promise<void> {
  const ctx = await openContext();
  let patch: Record<string, unknown> = {};
  if (opts.input) patch = (await readJsonInput(opts.input)) as Record<string, unknown>;
  if (opts.doing !== undefined) patch.doing = opts.doing;
  if (opts.next !== undefined) patch.next = opts.next;
  if (opts.blocked !== undefined) patch.blocked = opts.blocked;
  if (opts.notes !== undefined) patch.notes = opts.notes;
  if (opts.fyi?.length) {
    patch.fyi = opts.fyi.map((f) => {
      const i = f.lastIndexOf("=");
      return i > 0 ? { text: f.slice(0, i), ref: f.slice(i + 1) } : { text: f };
    });
  }
  if (opts.deliverable?.length) {
    patch.deliverables = opts.deliverable.map((d) => {
      const i = d.indexOf("=");
      if (i <= 0) throw new TandemError("usage", `--deliverable 格式是「標題=網址」：${d}`);
      return { title: d.slice(0, i), url: d.slice(i + 1) };
    });
  }
  const parsed = StatusPatch.safeParse(patch);
  if (!parsed.success) throw new TandemError("validation", `狀態格式不正確：${parsed.error.issues.map((i) => i.message).join("；")}`);
  const result = await updateStatus(ctx.store, ctx.me, parsed.data, { dryRun: opts.dryRun });
  if (opts.json) printJson(result);
  else if (opts.dryRun) process.stdout.write(`${result.content}\n（試寫，未存檔）\n`);
  else info(`已更新 @${ctx.me} 的狀態`);
  if (!opts.dryRun) reportWrite(result.write);
}

// ---------------------------------------------------------------------------
// check / sync
// ---------------------------------------------------------------------------
export async function cmdCheck(opts: JsonOpt & { fix?: boolean; quiet?: boolean }): Promise<void> {
  const ctx = await openContext();
  const r = await checkRecords(ctx.store, { fix: opts.fix });
  if (opts.json) printJson(r);
  else {
    printProblems(r.problems);
    for (const f of r.fixed) info(`已修正：${f}`);
    if (!opts.quiet && r.problems.length === 0) info("紀錄都沒有問題");
  }
  if (r.problems.some((p) => p.severity === "error")) process.exitCode = 1;
}

export async function cmdSync(opts: JsonOpt): Promise<void> {
  const ctx = await openContext();
  const r = await syncData(ctx.repoRoot, { gitEnv: ctx.gitEnv });
  if (opts.json) printJson(r);
  else {
    const msg = { ok: "已同步", nothing: "沒有需要同步的", conflict: "有衝突，紀錄先留在本機", offline: "目前離線" }[r.result];
    info(`${msg}${r.message ? `：${r.message}` : ""}`);
  }
  if (r.result === "conflict") process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// ask / disagree / resolve / task
// ---------------------------------------------------------------------------
export async function cmdAsk(login: string, opts: JsonOpt & { title: string; body: string }): Promise<void> {
  const ctx = await openContext();
  const r = await createDiscussionOrIssue(ctx.gh, { kind: "question", title: opts.title, body: opts.body, waitingOn: [login] });
  if (opts.json) printJson(r);
  else info(`已開${r.kind === "discussion" ? "討論" : " issue"}，等 @${login} 回應：${r.url}`);
}

export async function cmdDisagree(opts: JsonOpt & { with: string; title: string; body: string }): Promise<void> {
  const ctx = await openContext();
  const r = await createDiscussionOrIssue(ctx.gh, { kind: "disagreement", title: opts.title, body: opts.body, waitingOn: [opts.with] });
  if (opts.json) printJson(r);
  else info(`已開分歧討論，請 @${opts.with} 用自己的帳號寫下立場：${r.url}`);
}

export async function cmdResolve(target: string, opts: JsonOpt & { decision?: string; reason?: string }): Promise<void> {
  const ctx = await openContext();
  const number = Number(target.match(/(\d+)\/?$/)?.[1]);
  if (!Number.isInteger(number)) throw new TandemError("usage", `看不懂要結束哪一則討論：${target}`);
  if (opts.decision) {
    await ctx.gh.commentOnDiscussion(number, `🤖 ${PRODUCT.displayName}: 已定案，見決定 ${opts.decision}`);
  }
  const reason = (opts.reason?.toUpperCase() ?? "RESOLVED") as "RESOLVED" | "OUTDATED" | "DUPLICATE";
  await ctx.gh.closeDiscussion(number, reason);
  if (opts.json) printJson({ closed: number, decision: opts.decision ?? null });
  else info(`已結束討論 #${number}`);
}

export async function cmdTask(title: string, opts: JsonOpt & { assign?: string[]; body?: string }): Promise<void> {
  const ctx = await openContext();
  const r = await ctx.gh.createIssue({ title, body: opts.body, assignees: opts.assign, labels: [LABELS.task] });
  if (opts.json) printJson(r);
  else info(`已建立任務 #${r.number}：${r.url}`);
}

// ---------------------------------------------------------------------------
// invite / join
// ---------------------------------------------------------------------------
/** Public download page; the repo name rides in the fragment, never sent to a server. */
export const DOWNLOAD_PAGE = "https://sudo-studio-lab.github.io/tandem-releases/";

export function joinUrlFor(owner: string, name: string): string {
  return `${DOWNLOAD_PAGE}#join=${encodeURIComponent(`${owner}/${name}`)}`;
}

export function shareTextFor(owner: string, name: string): string {
  return [
    `我用 ${PRODUCT.displayName} 邀請你一起做 ${owner}/${name}。`,
    `下載 ${PRODUCT.displayName}、用 GitHub 登入，就會看到這個邀請：`,
    joinUrlFor(owner, name),
  ].join("\n");
}

export async function inviteLogin(ctx: Context, login: string) {
  const status = await ctx.gh.inviteCollaborator(login);
  return {
    invited: login,
    status,
    shareText: shareTextFor(ctx.remote.owner, ctx.remote.name),
    url: joinUrlFor(ctx.remote.owner, ctx.remote.name),
  };
}

export async function cmdInvite(login: string, opts: JsonOpt): Promise<void> {
  const ctx = await openContext();
  const r = await inviteLogin(ctx, login);
  if (opts.json) printJson(r);
  else {
    info(r.status === "invited" ? `已邀請 @${login}。把下面這段傳給對方：` : `@${login} 本來就有權限。把下面這段傳給對方：`);
    process.stdout.write(`\n${r.shareText}\n`);
  }
}

export async function cmdJoin(repoArg: string, opts: JsonOpt & { dir?: string; board?: boolean }): Promise<void> {
  const m = repoArg.match(/^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (!m) throw new TandemError("usage", "請用 owner/repo 的格式，例如 tandem join sudo-studio-lab/tandem");
  const [, owner, name] = m as unknown as [string, string, string];
  const { token } = await getGitHubToken();
  const app = await loadAppState();
  const r = await joinProject({
    owner,
    name,
    token,
    projectsDir: app.projectsDir,
    dir: opts.dir ? path.resolve(opts.dir) : path.resolve(name),
    progress: (_step, message) => info(message),
  });
  for (const p of r.setup.problems) info(`⚠ ${p}`);
  if (opts.json) printJson({ repo: `${owner}/${name}`, dir: r.dir });
  info(`完成。之後在 ${r.dir} 打開你的 Claude Code 或 Codex 就能開始。`);
  if (opts.board !== false) {
    const { startServer } = await import("./server.ts");
    await startServer({ cwd: r.dir });
  }
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return a === "y" || a === "yes";
  } finally {
    rl.close();
  }
}

export async function cmdInit(
  opts: JsonOpt & { check?: boolean; push?: boolean; enableDiscussions?: boolean; board?: boolean },
): Promise<void> {
  const ctx = await openContext();
  if (opts.check) {
    const items = await checkAgentIntegration(ctx.repoRoot);
    if (opts.json) printJson(items);
    else for (const i of items) info(`${i.state === "current" ? "✓" : i.state === "stale" ? "↻" : "✗"} ${i.item}（${i.path}）${i.note ? `：${i.note}` : ""}`);
    return;
  }

  const r = await setupProject(ctx, {
    enableDiscussions: async () =>
      opts.enableDiscussions ?? (await confirm("這個 repo 還沒開 GitHub Discussions（問題和分歧會放這裡）。要幫你開啟嗎？")),
    push: opts.push,
  });
  const { created, discussions } = r;
  await rememberProject(ctx).catch(() => undefined);
  for (const p of r.problems) info(`⚠ ${p}`);
  if (opts.json) printJson({ created, discussions });
  else {
    info(`${PRODUCT.displayName} 設定完成。`);
    if (created.length) info(`新增或更新：${created.join("、")}`);
    if (discussions === "disabled-fallback-issues") info("Discussions 沒有開，問題和分歧會先放在 Issues。");
    info("");
    info("每個人第一次需要做一次（agent 的安全確認，無法跳過）：");
    info("• Claude Code：在這個資料夾第一次開啟時，同意信任這個工作區");
    info("• Codex：信任這個專案，並在 /hooks 裡同意 Tandem 的 hook");
    info(`有問題可以執行 ${PRODUCT.command} doctor 檢查。`);
  }
  if (opts.board !== false && !opts.json) {
    const { startServer } = await import("./server.ts");
    await startServer({ cwd: ctx.repoRoot });
  }
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------
export async function cmdDoctor(opts: JsonOpt): Promise<void> {
  const results: { item: string; ok: boolean; note: string }[] = [];
  const add = (item: string, ok: boolean, note: string) => results.push({ item, ok, note });
  try {
    const t = await getGitHubToken();
    add("GitHub 登入", true, { gh: "借用 gh 的登入", keyring: "已用 Tandem 登入", env: "使用環境變數" }[t.source]);
  } catch (e) {
    add("GitHub 登入", false, e instanceof Error ? e.message : String(e));
  }
  try {
    const ctx = await openContext();
    add("專案", true, `${ctx.remote.owner}/${ctx.remote.name}，你是 @${ctx.me}`);
    try {
      const d = await ctx.gh.getDiscussionsInfo();
      add("GitHub Discussions", d.enabled, d.enabled ? (d.qaCategoryId ? "已開啟，有 Q&A 分類" : "已開啟，但找不到可以標記答案的分類") : `沒開，執行 ${PRODUCT.command} init 開啟`);
    } catch (e) {
      add("GitHub Discussions", false, e instanceof Error ? e.message : String(e));
    }
    for (const i of await checkAgentIntegration(ctx.repoRoot)) {
      add(i.item, i.state === "current", i.state === "current" ? "最新" : i.state === "stale" ? `過期，執行 ${PRODUCT.command} init 更新` : `缺少，執行 ${PRODUCT.command} init`);
    }
    const r = await checkRecords(ctx.store, {});
    const errs = r.problems.filter((p) => p.severity === "error").length;
    add("紀錄格式", errs === 0, errs === 0 ? "沒有問題" : `${errs} 個錯誤，執行 ${PRODUCT.command} check 查看`);
  } catch (e) {
    add("專案", false, e instanceof Error ? e.message : String(e));
  }
  add("信任設定", true, "Claude Code 要信任這個工作區；Codex 要信任專案並在 /hooks 同意（無法自動檢查）");
  if (opts.json) printJson(results);
  else for (const r of results) info(`${r.ok ? "✓" : "✗"} ${r.item}：${r.note}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

