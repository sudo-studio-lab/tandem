import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GitHubLogin,
  PATHS,
  StatusFrontmatter,
  StatusPatch,
  TandemError,
  type Problem,
  type Status,
} from "@tandem/contracts";
import { localIsoString } from "./ids.ts";
import { splitFrontmatter, stringifyFrontmatter, zodProblems } from "./frontmatter.ts";

export function renderStatus(status: StatusFrontmatter & { notes?: string }): string {
  const fm: Record<string, unknown> = {
    login: status.login,
    updated: status.updated,
    doing: status.doing,
    next: status.next,
    blocked: status.blocked,
    fyi: status.fyi.map((f) => (f.ref ? { text: f.text, ref: f.ref } : { text: f.text })),
    deliverables: status.deliverables.map((d) => ({ title: d.title, url: d.url })),
  };
  const notes = (status.notes ?? "").trim();
  return `${stringifyFrontmatter(fm)}${notes ? `\n${notes}\n` : ""}`;
}

export function parseStatus(path: string, content: string): { status?: Status; problems: Problem[] } {
  const split = splitFrontmatter(content);
  if (!split.ok) return { problems: [{ path, severity: "error", code: "bad-frontmatter", message: split.message }] };
  const fm = StatusFrontmatter.safeParse(split.data);
  if (!fm.success) return { problems: zodProblems(path, fm.error) };
  const problems: Problem[] = [];
  const fileLogin = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  if (fileLogin !== fm.data.login)
    problems.push({
      path,
      severity: "error",
      code: "status-login-mismatch",
      message: `檔名「${fileLogin}」和 login「${fm.data.login}」不一致`,
    });
  return { status: { ...fm.data, path, notes: split.body.trim() }, problems };
}

export async function loadStatuses(repoRoot: string): Promise<{ statuses: Status[]; problems: Problem[] }> {
  const statuses: Status[] = [];
  const problems: Problem[] = [];
  let names: string[] = [];
  try {
    names = (await readdir(join(repoRoot, PATHS.status))).filter((n) => n.endsWith(".md")).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  for (const name of names) {
    const path = `${PATHS.status}/${name}`;
    const r = parseStatus(path, await readFile(join(repoRoot, path), "utf8"));
    problems.push(...r.problems);
    if (r.status) statuses.push(r.status);
  }
  return { statuses, problems };
}

export interface UpdateStatusResult {
  path: string;
  content: string;
  status: Status;
  problems: Problem[];
}

/** Merge `patch` into the status file of `login` (only ever that person's own file). */
export async function updateStatus(
  repoRoot: string,
  login: string,
  patch: StatusPatch,
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<UpdateStatusResult> {
  const lg = GitHubLogin.safeParse(login);
  if (!lg.success) throw new TandemError("validation", `GitHub 帳號格式不正確：${login}`);
  const p = StatusPatch.safeParse(patch);
  if (!p.success)
    throw new TandemError("validation", p.error.issues.map((i) => `${i.path.join(".")}：${i.message}`).join("；"), p.error.issues);

  const path = `${PATHS.status}/${login}.md`;
  const abs = join(repoRoot, path);
  const problems: Problem[] = [];
  let current: Status | undefined;
  let existing: string | undefined;
  try {
    existing = await readFile(abs, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (existing !== undefined) {
    const split = splitFrontmatter(existing);
    if (split.ok && typeof split.data.login === "string" && split.data.login !== login)
      throw new TandemError("validation", `只能更新自己的狀態檔：這個檔案屬於 @${split.data.login}，不是 @${login}`);
    const r = parseStatus(path, existing);
    current = r.status;
    if (!current)
      problems.push({
        path,
        severity: "warning",
        code: "status-reset",
        message: "原本的狀態檔無法解析，已整份重寫",
      });
  }

  const merged = {
    login,
    updated: localIsoString(opts.now ?? new Date()),
    doing: p.data.doing ?? current?.doing ?? "",
    next: p.data.next ?? current?.next ?? "",
    blocked: p.data.blocked ?? current?.blocked ?? "",
    fyi: p.data.fyi ?? current?.fyi ?? [],
    deliverables: p.data.deliverables ?? current?.deliverables ?? [],
  };
  const fm = StatusFrontmatter.safeParse(merged);
  if (!fm.success)
    throw new TandemError("validation", zodProblems(path, fm.error).map((x) => x.message).join("；"), fm.error.issues);
  const notes = p.data.notes ?? current?.notes ?? "";
  const content = renderStatus({ ...fm.data, notes });
  if (!opts.dryRun) {
    await mkdir(join(repoRoot, PATHS.status), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return { path, content, status: { ...fm.data, path, notes: notes.trim() }, problems };
}
