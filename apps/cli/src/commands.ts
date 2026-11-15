/** Command implementations. Spec: specs/001-core/contracts/cli.md */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import {
  LABELS,
  PATHS,
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
  createGitHubClient,
  findRepoRoot,
  getGitHubToken,
  installAgentIntegration,
  installPreCommitHook,
  renderBrief,
  runGit,
  syncData,
  updateStatus,
} from "@tandem/core";
import { openContext, withTimeout, type Context } from "./context.ts";
import { buildBrief, gatherGitHub } from "./gather.ts";
import { info, printJson, readJsonInput } from "./io.ts";

interface JsonOpt {
  json?: boolean;
}

async function syncQuietly(ctx: Context): Promise<void> {
  const r = await syncData(ctx.repoRoot, { dataDir: PRODUCT.dataDir });
  if (r.result === "conflict") info(`⚠ 同步時發生衝突，紀錄先留在本機：${r.message ?? ""}`);
  else if (r.result === "offline") info("⚠ 目前離線，紀錄先留在本機，連上網後會再同步");
}

function printProblems(problems: Problem[]): void {
  for (const p of problems) info(`${p.severity === "error" ? "✗" : "!"} ${p.path}：${p.message}`);
}

// ---------------------------------------------------------------------------
// brief
// ---------------------------------------------------------------------------
export async function cmdBrief(opts: JsonOpt & { peek?: boolean }): Promise<void> {
  const ctx = await openContext();
  await syncData(ctx.repoRoot, { dataDir: PRODUCT.dataDir }).catch(() => undefined);
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

  const result = await createDecision(ctx.repoRoot, raw as DecisionInput, { dryRun: opts.dryRun });
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
  if (!opts.dryRun && opts.sync !== false) await syncQuietly(ctx);
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
  const result = await updateStatus(ctx.repoRoot, ctx.me, parsed.data, { dryRun: opts.dryRun });
  if (opts.json) printJson(result);
  else info(opts.dryRun ? "（試寫，未存檔）" : `已更新 @${ctx.me} 的狀態`);
  if (!opts.dryRun && opts.sync !== false) await syncQuietly(ctx);
}

// ---------------------------------------------------------------------------
// check / sync
// ---------------------------------------------------------------------------
export async function cmdCheck(opts: JsonOpt & { fix?: boolean; quiet?: boolean }): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const r = await checkRecords(repoRoot, { fix: opts.fix });
  if (opts.json) printJson(r);
  else {
    printProblems(r.problems);
    for (const f of r.fixed) info(`已修正：${f}`);
    if (!opts.quiet && r.problems.length === 0) info("紀錄都沒有問題");
  }
  if (r.problems.some((p) => p.severity === "error")) process.exitCode = 1;
}

export async function cmdSync(opts: JsonOpt): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const r = await syncData(repoRoot, { dataDir: PRODUCT.dataDir });
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
export function shareTextFor(owner: string, name: string): string {
  return [
    `我用 ${PRODUCT.displayName} 邀請你一起做 ${owner}/${name}。`,
    `1. 安裝 ${PRODUCT.command}（目前從 sudo-studio-lab/tandem 安裝，見它的 README）`,
    `2. 執行：${PRODUCT.command} join ${owner}/${name}`,
    "會自動接受邀請、下載專案、打開看板。",
  ].join("\n");
}

export async function inviteLogin(ctx: Context, login: string) {
  const status = await ctx.gh.inviteCollaborator(login);
  return { invited: login, status, shareText: shareTextFor(ctx.remote.owner, ctx.remote.name) };
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
  const gh = createGitHubClient({ token, owner, repo: name });
  const accepted = await gh.acceptInvitationFor();
  info(accepted === "accepted" ? `已接受 ${owner}/${name} 的邀請` : `沒有待接受的邀請（可能本來就有權限）`);

  const dir = path.resolve(opts.dir ?? name);
  if (!existsSync(path.join(dir, ".git"))) {
    info(`下載專案到 ${dir} …`);
    const viaGh = spawnSync("gh", ["repo", "clone", `${owner}/${name}`, dir], { stdio: "inherit" });
    if (viaGh.status !== 0) {
      const viaGit = spawnSync("git", ["clone", `https://github.com/${owner}/${name}.git`, dir], { stdio: "inherit" });
      if (viaGit.status !== 0) throw new TandemError("github", "下載專案失敗，請確認有權限、網路正常");
    }
  } else info(`${dir} 已經有這個專案了`);

  process.chdir(dir);
  const ctx = await openContext(dir);
  await updateStatus(ctx.repoRoot, ctx.me, {}, {});
  await syncQuietly(ctx);
  if (opts.json) printJson({ repo: `${owner}/${name}`, dir, accepted });
  info(`完成。之後在 ${dir} 打開你的 Claude Code 或 Codex 就能開始。`);
  if (opts.board !== false) {
    const { startBoard } = await import("./server.ts");
    await startBoard({ cwd: dir });
  }
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
const TEAM_TEMPLATE = `# 團隊習慣

用白話寫這個團隊的習慣，每個人的 agent 開工時都會讀。想到再加，不用一次寫完。

例如：
- 設計相關的決定都要問 @某人
- 黑客松期間不開討論，直接記決定，有意見再提
`;

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

  const created: string[] = [];
  await mkdir(path.join(ctx.repoRoot, PATHS.decisions), { recursive: true });
  const keep = path.join(ctx.repoRoot, PATHS.decisions, ".gitkeep");
  if (!existsSync(keep)) {
    await writeFile(keep, "");
    created.push(`${PATHS.decisions}/.gitkeep`);
  }
  const team = path.join(ctx.repoRoot, PATHS.team);
  if (!existsSync(team)) {
    await writeFile(team, TEAM_TEMPLATE);
    created.push(PATHS.team);
  }
  await updateStatus(ctx.repoRoot, ctx.me, {}, {});

  const changes = await installAgentIntegration(ctx.repoRoot);
  for (const c of changes) if (c.action !== "unchanged") created.push(c.path);
  await installPreCommitHook(
    ctx.repoRoot,
    `if command -v ${PRODUCT.command} >/dev/null 2>&1; then ${PRODUCT.command} check --quiet; fi`,
  );

  // Discussions (research R18): ask before changing a repo setting.
  let discussions = "unknown";
  try {
    const d = await ctx.gh.getDiscussionsInfo();
    if (!d.enabled) {
      const yes = opts.enableDiscussions ?? (await confirm("這個 repo 還沒開 GitHub Discussions（問題和分歧會放這裡）。要幫你開啟嗎？"));
      if (yes) {
        await ctx.gh.enableDiscussions();
        discussions = "enabled";
      } else discussions = "disabled-fallback-issues";
    } else discussions = "enabled";
    await ctx.gh.ensureLabels();
  } catch (e) {
    info(`⚠ 設定 GitHub 時出了問題：${e instanceof Error ? e.message : String(e)}`);
  }

  // Commit the shared setup so teammates get it.
  const paths = [PRODUCT.dataDir, "AGENTS.md", "CLAUDE.md", ".claude/settings.json", ".claude/skills", ".codex/hooks.json", ".agents/skills"]
    .filter((p) => existsSync(path.join(ctx.repoRoot, p)));
  await runGit(["add", "--", ...paths], { cwd: ctx.repoRoot });
  const staged = await runGit(["diff", "--cached", "--quiet"], { cwd: ctx.repoRoot, allowFail: true });
  if (staged.code !== 0) {
    await runGit(["commit", "-m", `${PRODUCT.command}: set up ${PRODUCT.displayName}`], { cwd: ctx.repoRoot });
  }
  if (opts.push !== false) await syncQuietly(ctx);

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
    const { startBoard } = await import("./server.ts");
    await startBoard({ cwd: ctx.repoRoot });
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
    add("GitHub 登入", true, t.source === "gh" ? "借用 gh 的登入" : "使用環境變數");
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
    const r = await checkRecords(ctx.repoRoot, {});
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

// Silence "unused" for helpers re-exported for tests.
export const _internal = { TEAM_TEMPLATE };
