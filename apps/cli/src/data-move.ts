/**
 * `tandem data move --to owner/name`: one-time move of team data (decisions, status, team.md)
 * from the code repo into a separate (private) data repo.
 *
 * Copies through the data store as one commit (never deletes or overwrites anything in the data
 * repo) and writes `.tandem.json`. It does NOT remove the old files from the code repo, commit or
 * push it: it prints what the user should remove and merge through a PR. The old content stays
 * in the code repo's git history; nothing here rewrites history.
 */
import { PATHS, PRODUCT, TandemError, parseRepoFullName } from "@tandem/contracts";
import {
  copyTeamData,
  ensureDataRepo,
  openGitDataStore,
  syncData,
  writeTandemConfig,
  type CopyResult,
  type DataRepoOptions,
} from "@tandem/core";
import { authorFor, openContext, type Context } from "./context.ts";
import { info, printJson } from "./io.ts";

export interface MoveResult extends CopyResult {
  from: string;
  to: string;
  /** The code repo's default branch the data was read from. */
  branch: string;
  dryRun: boolean;
  /** Path of the written .tandem.json (not set on a dry run or when the copy did not land). */
  configWritten?: string;
  /** Paths the user should `git rm` from the code repo in a PR. */
  remove: string[];
}

export async function moveTeamData(
  ctx: Pick<Context, "repoRoot" | "remote" | "me" | "gitEnv">,
  to: string,
  opts: { dryRun?: boolean; data?: Omit<DataRepoOptions, "gitEnv"> } = {},
): Promise<MoveResult> {
  const target = parseRepoFullName(to);
  if (!target) throw new TandemError("usage", "--to 要寫成 owner/name，例如 my-team/team-data");
  const from = `${ctx.remote.owner}/${ctx.remote.name}`;
  const toName = `${target.owner}/${target.name}`;
  if (from.toLowerCase() === toName.toLowerCase()) throw new TandemError("usage", "團隊資料 repo 要跟程式碼 repo 不同");

  // Source: what the code repo's remote default branch has (plus anything still waiting to be sent).
  const fetched = await syncData(ctx.repoRoot, { gitEnv: ctx.gitEnv, push: false });
  if (fetched.result === "offline") throw new TandemError("offline", "連不上程式碼 repo，請連上網再試");
  const source = openGitDataStore(ctx.repoRoot, { gitEnv: ctx.gitEnv });
  const branch = await source.defaultBranch();

  // Target: the local copy of the data repo, freshly fetched.
  const dataRoot = await ensureDataRepo(target.owner, target.name, { ...opts.data, gitEnv: ctx.gitEnv });
  const t = await syncData(dataRoot, { gitEnv: ctx.gitEnv, push: false });
  if (t.result === "offline") throw new TandemError("offline", `連不上 ${toName}，請連上網再試`);
  const dest = openGitDataStore(dataRoot, { gitEnv: ctx.gitEnv, author: await authorFor(ctx.repoRoot, ctx.me) });

  const copied = await copyTeamData(source, dest, {
    dryRun: opts.dryRun,
    message: `${PRODUCT.command}: move team data from ${from}`,
  });
  const all = [...copied.copy, ...copied.same, ...copied.differ];
  const remove = [PATHS.decisions, PATHS.status, PATHS.team].filter((p) => all.some((x) => x === p || x.startsWith(`${p}/`)));
  const result: MoveResult = { ...copied, from, to: toName, branch, dryRun: !!opts.dryRun, remove };
  if (opts.dryRun) return result;
  if (copied.write && copied.write.result !== "pushed") return result;
  result.configWritten = writeTandemConfig(ctx.repoRoot, { dataRepo: toName });
  return result;
}

/** Human report: what was copied, then exactly what to remove and commit through a PR. */
export function renderMoveReport(r: MoveResult): string[] {
  const out: string[] = [];
  out.push(r.dryRun ? `試跑：從 ${r.from}（${r.branch} 分支）複製到 ${r.to}，什麼都不會寫入。` : `從 ${r.from}（${r.branch} 分支）複製到 ${r.to}：`);
  for (const p of r.copy) out.push(`  + ${p}`);
  if (r.same.length) out.push(`  = ${r.same.length} 個檔案 ${r.to} 已經有了（內容相同），略過`);
  for (const p of r.differ) out.push(`  ! ${p}：${r.to} 已經有這個檔案但內容不同，沒有覆蓋，請自己比對`);
  if (r.copy.length === 0) out.push("  沒有需要複製的檔案");
  if (r.dryRun) {
    out.push("", `正式執行會再寫入 ${PRODUCT.configFile}（"dataRepo": "${r.to}"）。拿掉 --dry-run 就會執行。`);
    return out;
  }
  if (r.write && r.write.result !== "pushed") {
    out.push("", `✗ 還沒送到 ${r.to}：${r.write.message ?? r.write.result}`, `所以沒有寫 ${PRODUCT.configFile}。問題排除後再執行一次。`);
    return out;
  }
  out.push(
    r.copy.length ? `已複製 ${r.copy.length} 個檔案到 ${r.to}（一個 commit）。` : `${r.to} 已經是最新的。`,
    `已寫入 ${PRODUCT.configFile}：這台電腦的 ${PRODUCT.displayName} 從現在起讀寫 ${r.to}。`,
    "",
    `接下來請你自己用 PR 完成（這個指令不會 commit 或推送 ${r.from}）：`,
    `  git switch -c ${PRODUCT.command}-data-move origin/${r.branch}`,
    ...(r.remove.length ? [`  git rm -r -- ${r.remove.join(" ")}`] : []),
    `  git add ${PRODUCT.configFile}`,
    `  git commit -m "${PRODUCT.command}: move team data to ${r.to}"`,
    `  git push -u origin ${PRODUCT.command}-data-move`,
    "  然後開 PR、合併。",
    "",
    "注意：",
    `• 舊的內容還留在 ${r.from} 的 git 歷史裡，公開 repo 的話任何人都看得到。這個指令不改寫歷史，也請不要 force push。`,
    `• 隊友要更新到新版 ${PRODUCT.displayName}；舊版會繼續寫到 ${r.from}。PR 合併前寫進去的新紀錄，可以再執行一次這個指令補過去。`,
  );
  return out;
}

export async function cmdDataMove(opts: { to: string; dryRun?: boolean; json?: boolean }): Promise<void> {
  const ctx = await openContext();
  const r = await moveTeamData(ctx, opts.to, { dryRun: opts.dryRun });
  if (opts.json) printJson(r);
  else for (const line of renderMoveReport(r)) info(line);
  if (r.write && r.write.result !== "pushed") process.exitCode = 1;
}
