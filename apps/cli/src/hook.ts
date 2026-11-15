/**
 * `tandem hook <event> --agent claude|codex` — called by agent hooks, never by people.
 * Must always print valid JSON and never fail the agent.
 */
import { createHash } from "node:crypto";
import { PRODUCT } from "@tandem/contracts";
import { formatHookOutput, headCommit, loadStatuses, readHookInput, renderAgentContext, runGit, syncData } from "@tandem/core";
import { openContext, withTimeout } from "./context.ts";
import { buildBrief, gatherGitHub } from "./gather.ts";
import { readStdin } from "./io.ts";

type Agent = "claude" | "codex";
type HookEvent = "session-start" | "stop" | "user-prompt" | "post-compact";

const HOOK_BUDGET_MS = 12_000;

async function sessionContext(ctx: Awaited<ReturnType<typeof openContext>>): Promise<string> {
  await withTimeout(syncData(ctx.repoRoot, { gitEnv: ctx.gitEnv }).catch(() => undefined), 6_000, undefined);
  const gh = await withTimeout(gatherGitHub(ctx), 6_000, null);
  const { brief, head } = await buildBrief(ctx, gh);
  ctx.state.lastBrief = { commit: head, time: new Date().toISOString() };
  return renderAgentContext(brief);
}

/**
 * Fingerprint of uncommitted work outside the data folder: tracked changes (content) plus the list of
 * untracked files. Read-only. Lets the stop hook tell "changed during this session" from "was
 * already dirty when the session started".
 */
async function workingTreePrint(repoRoot: string): Promise<string> {
  const spec = ["--", ".", `:(exclude)${PRODUCT.dataDir}`];
  const [diff, status] = await Promise.all([
    runGit(["diff", "HEAD", "--no-ext-diff", ...spec], { cwd: repoRoot, allowFail: true }),
    runGit(["status", "--porcelain", "--untracked-files=all", ...spec], { cwd: repoRoot, allowFail: true }),
  ]);
  return createHash("sha256").update(diff.stdout).update("\0").update(status.stdout).digest("hex").slice(0, 16);
}

/** Did the user's work change anything since the session started (outside the data folder)? */
async function workChangedSince(repoRoot: string, head: string | null, tree: string | undefined): Promise<boolean> {
  const print = await workingTreePrint(repoRoot);
  // Older sessions (no fingerprint): any uncommitted change counts, as before.
  if (tree === undefined) {
    const dirty = await runGit(["status", "--porcelain", "--", ".", `:(exclude)${PRODUCT.dataDir}`], { cwd: repoRoot, allowFail: true });
    if (dirty.stdout.trim()) return true;
  } else if (print !== tree) return true;
  if (!head) return false;
  const log = await runGit(["log", "--format=%H", `${head}..HEAD`, "--", ".", `:(exclude)${PRODUCT.dataDir}`], {
    cwd: repoRoot,
    allowFail: true,
  });
  return log.stdout.trim().length > 0;
}

/** Records live on the remote default branch now, so read my status through the store. */
async function statusTouchedSince(ctx: Awaited<ReturnType<typeof openContext>>, sinceIso: string): Promise<boolean> {
  const { statuses } = await loadStatuses(ctx.store);
  const mine = statuses.find((s) => s.login.toLowerCase() === ctx.me.toLowerCase());
  return !!mine && Date.parse(mine.updated) >= Date.parse(sinceIso);
}

async function handle(event: HookEvent, agent: Agent, stdin: string): Promise<string> {
  const input = readHookInput(stdin);
  const sessionId = input.sessionId ?? "unknown";
  const ctx = await openContext();
  ctx.state.sessions ??= {};
  // Keep the session table small.
  const entries = Object.entries(ctx.state.sessions).sort((a, b) => b[1].startedAt.localeCompare(a[1].startedAt));
  ctx.state.sessions = Object.fromEntries(entries.slice(0, 20));

  try {
    switch (event) {
      case "session-start": {
        const context = await sessionContext(ctx);
        const existing = ctx.state.sessions[sessionId];
        ctx.state.sessions[sessionId] = existing ?? {
          startedAt: new Date().toISOString(),
          head: await headCommit(ctx.repoRoot),
          tree: await workingTreePrint(ctx.repoRoot),
        };
        return formatHookOutput(agent, "session-start", { context });
      }
      case "post-compact": {
        const s = ctx.state.sessions[sessionId];
        if (s) s.reinject = true;
        return formatHookOutput(agent, "post-compact", {});
      }
      case "user-prompt": {
        const s = ctx.state.sessions[sessionId];
        if (s?.reinject) {
          s.reinject = false;
          return formatHookOutput(agent, "user-prompt", { context: await sessionContext(ctx) });
        }
        return formatHookOutput(agent, "user-prompt", {});
      }
      case "stop": {
        const s = ctx.state.sessions[sessionId];
        if (input.stopHookActive || !s || s.nudged) return formatHookOutput(agent, "stop", {});
        const worked = await workChangedSince(ctx.repoRoot, s.head, s.tree);
        if (!worked) return formatHookOutput(agent, "stop", {});
        if (await statusTouchedSince(ctx, s.startedAt)) return formatHookOutput(agent, "stop", {});
        s.nudged = true;
        return formatHookOutput(agent, "stop", {
          blockReason: `這次有做事，但 @${ctx.me} 的 ${PRODUCT.displayName} 狀態還沒更新。請用 \`${PRODUCT.command}_status\` 工具（沒有的話用 \`${PRODUCT.command} status --doing … --next … [--deliverable 標題=網址]\`）更新後再結束（只提醒這一次）。`,
        });
      }
    }
  } finally {
    await ctx.saveState().catch(() => undefined);
  }
}

export async function cmdHook(event: string, opts: { agent?: string }): Promise<void> {
  const agent: Agent = opts.agent === "codex" ? "codex" : "claude";
  const ev = (["session-start", "stop", "user-prompt", "post-compact"] as const).find((e) => e === event);
  let out: string;
  try {
    if (!ev) throw new Error(`unknown hook event ${event}`);
    const stdin = process.stdin.isTTY ? "" : await withTimeout(readStdin(), 2_000, "");
    out = await withTimeout(handle(ev, agent, stdin), HOOK_BUDGET_MS, formatHookOutput(agent, ev, {}));
  } catch (e) {
    // Never break the agent: log to stderr and allow.
    process.stderr.write(`[${PRODUCT.command} hook] ${e instanceof Error ? e.message : String(e)}\n`);
    out = formatHookOutput(agent, ev ?? "stop", {});
  }
  process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
}
