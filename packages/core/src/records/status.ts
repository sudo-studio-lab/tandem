import {
  GitHubLogin,
  PATHS,
  StatusFrontmatter,
  StatusPatch,
  TandemError,
  type Problem,
  type Status,
} from "@tandem/contracts";
import { openFsDataStore, type DataStore, type WriteResult } from "../data/index.ts";
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

function asStore(store: DataStore | string): DataStore {
  return typeof store === "string" ? openFsDataStore(store) : store;
}

export async function loadStatuses(storeOrRoot: DataStore | string): Promise<{ statuses: Status[]; problems: Problem[] }> {
  const store = asStore(storeOrRoot);
  const statuses: Status[] = [];
  const problems: Problem[] = [];
  const paths = (await store.list("status")).map((n) => `${PATHS.status}/${n}`);
  const contents: (string | null)[] = new Array<string | null>(paths.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= paths.length) return;
      contents[i] = await store.read(paths[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, paths.length) }, worker));
  paths.forEach((path, i) => {
    const content = contents[i];
    if (content === null || content === undefined) return;
    const r = parseStatus(path, content);
    problems.push(...r.problems);
    if (r.status) statuses.push(r.status);
  });
  return { statuses, problems };
}

export interface UpdateStatusResult {
  path: string;
  content: string;
  status: Status;
  problems: Problem[];
  /** Result of writing through the store (absent for dry runs). */
  write?: WriteResult;
}

/** Merge `patch` into the status file of `login` (only ever that person's own file). */
export async function updateStatus(
  storeOrRoot: DataStore | string,
  login: string,
  patch: StatusPatch,
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<UpdateStatusResult> {
  const store = asStore(storeOrRoot);
  const lg = GitHubLogin.safeParse(login);
  if (!lg.success) throw new TandemError("validation", `GitHub 帳號格式不正確：${login}`);
  const p = StatusPatch.safeParse(patch);
  if (!p.success)
    throw new TandemError("validation", p.error.issues.map((i) => `${i.path.join(".")}：${i.message}`).join("；"), p.error.issues);

  const path = `${PATHS.status}/${login}.md`;
  const problems: Problem[] = [];
  let current: Status | undefined;
  const existing = await store.read(path);
  if (existing !== null) {
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
  const result: UpdateStatusResult = { path, content, status: { ...fm.data, path, notes: notes.trim() }, problems };
  if (!opts.dryRun) result.write = await store.write([{ path, content }], `tandem: update status @${login}`);
  return result;
}
