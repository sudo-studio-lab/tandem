import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { PATHS, TandemError } from "@tandem/contracts";
import { runGit, type RunGitResult } from "../git/run.ts";
import { withFileLock } from "./lock.ts";
import { assertRelPath, isNetworkError, NETWORK_RE } from "./net.ts";
import type { DataStore, FileChange, GitDataStoreOptions, WriteResult } from "./types.ts";

const NET_TIMEOUT = 60_000;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_ATTEMPTS = 3;
const OFFLINE_MSG = "連不上遠端，稍後會自動重試。";

interface OutboxEntry {
  changes: FileChange[];
  message: string;
  author: { name: string; email: string } | null;
  createdAt: string;
}
interface OutboxItem {
  file: string;
  entry: OutboxEntry;
}

const rand = (): string => randomBytes(4).toString("hex");

export function openGitDataStore(repoRoot: string, opts: GitDataStoreOptions = {}): DataStore {
  const remote = opts.remote ?? "origin";
  let tandemDirP: Promise<string> | undefined;
  let branchCache: string | undefined;

  const git = (
    args: string[],
    o: { env?: Record<string, string>; allowFail?: boolean; timeoutMs?: number } = {},
  ): Promise<RunGitResult> =>
    runGit(args, {
      cwd: repoRoot,
      env: { ...opts.gitEnv, ...o.env },
      allowFail: o.allowFail,
      timeoutMs: o.timeoutMs,
    });

  const tandemDir = (): Promise<string> => {
    tandemDirP ??= git(["rev-parse", "--git-path", "tandem"]).then((r) => path.resolve(repoRoot, r.stdout.trim()));
    return tandemDirP;
  };
  const sub = async (name: string): Promise<string> => path.join(await tandemDir(), name);

  // ---- default branch -------------------------------------------------------
  async function defaultBranch(): Promise<string> {
    if (branchCache) return branchCache;
    const cacheFile = await sub("default-branch");
    try {
      const cached = fs.readFileSync(cacheFile, "utf8").trim();
      if (cached) return (branchCache = cached);
    } catch {
      // not cached yet
    }
    let found: string | undefined;
    const sym = await git(["symbolic-ref", "--short", "-q", `refs/remotes/${remote}/HEAD`], { allowFail: true });
    if (sym.code === 0 && sym.stdout.trim()) found = sym.stdout.trim().replace(`${remote}/`, "");
    if (!found) {
      const ls = await git(["ls-remote", "--symref", remote, "HEAD"], { allowFail: true, timeoutMs: 20_000 }).catch(
        () => undefined,
      );
      const m = ls && ls.code === 0 ? /^ref:\s+refs\/heads\/(\S+)\s+HEAD/m.exec(ls.stdout) : null;
      if (m?.[1]) found = m[1];
    }
    if (!found) return "main"; // not cached: the remote may be empty or unreachable right now
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, `${found}\n`);
    } catch {
      // cache is best-effort
    }
    return (branchCache = found);
  }

  const remoteRef = async (): Promise<string> => `refs/remotes/${remote}/${await defaultBranch()}`;

  async function remoteSha(): Promise<string | null> {
    const r = await git(["rev-parse", "--verify", "-q", `${await remoteRef()}^{commit}`], { allowFail: true });
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  }

  // ---- outbox ---------------------------------------------------------------
  async function readOutbox(): Promise<OutboxItem[]> {
    const dir = await sub("outbox");
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const items: OutboxItem[] = [];
    for (const file of names.filter((n) => n.endsWith(".json")).sort()) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as OutboxEntry;
        if (Array.isArray(entry.changes)) items.push({ file, entry });
      } catch {
        // half-written or foreign file: ignore
      }
    }
    return items;
  }

  async function authorFor(): Promise<{ name: string; email: string } | null> {
    if (opts.author) return opts.author;
    const n = await git(["config", "user.name"], { allowFail: true });
    const e = await git(["config", "user.email"], { allowFail: true });
    const name = n.stdout.trim();
    const email = e.stdout.trim();
    return name && email ? { name, email } : null;
  }

  async function appendOutbox(changes: FileChange[], message: string): Promise<void> {
    const dir = await sub("outbox");
    fs.mkdirSync(dir, { recursive: true });
    const entry: OutboxEntry = { changes, message, author: await authorFor(), createdAt: new Date().toISOString() };
    const name = `${Date.now().toString().padStart(13, "0")}-${rand()}.json`;
    const tmp = path.join(dir, `${name}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(entry), "utf8");
    fs.renameSync(tmp, path.join(dir, name));
  }

  // ---- reads ----------------------------------------------------------------
  async function list(dir: "decisions" | "status"): Promise<string[]> {
    const prefix = `${PATHS[dir]}/`;
    const names = new Set<string>();
    if (await remoteSha()) {
      const r = await git(["ls-tree", "-z", "--name-only", await remoteRef(), "--", prefix], { allowFail: true });
      if (r.code === 0) for (const p of r.stdout.split("\0")) if (p.startsWith(prefix)) names.add(p.slice(prefix.length));
    }
    for (const { entry } of await readOutbox()) {
      for (const c of entry.changes) {
        if (!c.path.startsWith(prefix)) continue;
        const rest = c.path.slice(prefix.length);
        if (rest.includes("/")) continue;
        if (c.content === null) names.delete(rest);
        else names.add(rest);
      }
    }
    return [...names].filter((n) => n.endsWith(".md")).sort();
  }

  async function read(p: string): Promise<string | null> {
    assertRelPath(p);
    let content: string | null = null;
    if (await remoteSha()) {
      const r = await git(["cat-file", "blob", `${await remoteRef()}:${p}`], { allowFail: true });
      if (r.code === 0) content = r.stdout;
    }
    for (const { entry } of await readOutbox()) for (const c of entry.changes) if (c.path === p) content = c.content;
    return content;
  }

  // ---- flush ----------------------------------------------------------------
  type Fetched = { kind: "ok"; base: string | null } | { kind: "offline"; message: string };

  async function fetchBranch(branch: string): Promise<Fetched> {
    const spec = `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`;
    const r = await git(["fetch", "--no-tags", remote, spec], { allowFail: true, timeoutMs: NET_TIMEOUT });
    if (r.code === 0) return { kind: "ok", base: await remoteSha() };
    if (/couldn't find remote ref/i.test(r.stderr)) return { kind: "ok", base: null };
    if (NETWORK_RE.test(r.stderr)) return { kind: "offline", message: OFFLINE_MSG };
    throw new TandemError("internal", `git fetch 失敗：${r.stderr.trim()}`, { stderr: r.stderr });
  }

  async function hashContent(content: string): Promise<string> {
    const tmp = await sub(`blob-${process.pid}-${rand()}`);
    fs.writeFileSync(tmp, content, "utf8");
    try {
      return (await git(["hash-object", "-w", "--no-filters", "--", tmp])).stdout.trim();
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  async function mergeAuthor(items: OutboxItem[]): Promise<{ name: string; email: string }> {
    return (
      opts.author ??
      items.find((i) => i.entry.author)?.entry.author ??
      (await authorFor()) ?? { name: "Tandem", email: "tandem@localhost" }
    );
  }

  function commitMessage(items: OutboxItem[]): string {
    const msgs = items.map((i) => i.entry.message).filter(Boolean);
    if (msgs.length <= 1) return msgs[0] ?? "tandem: update records";
    return `tandem: update records (${msgs.length})\n\n${msgs.map((m) => `- ${m}`).join("\n")}`;
  }

  async function flushLocked(touch: () => void): Promise<WriteResult> {
    const branch = await defaultBranch();
    const dir = await tandemDir();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const items = await readOutbox();
      if (items.length === 0) return { result: "pushed" };
      touch();
      const fetched = await fetchBranch(branch);
      if (fetched.kind === "offline") return { result: "offline", message: fetched.message };
      const base = fetched.base;

      const idx = path.join(dir, `index-${process.pid}-${rand()}`);
      const ix = (args: string[]): Promise<RunGitResult> => git(args, { env: { GIT_INDEX_FILE: idx } });
      let tree: string;
      const included: OutboxItem[] = [];
      const conflicted: OutboxItem[] = [];
      const conflictPaths: string[] = [];
      try {
        if (base) await ix(["read-tree", base]);
        else await ix(["read-tree", "--empty"]);
        for (const item of items) {
          const clashes: string[] = [];
          for (const c of item.entry.changes) {
            if (!c.createOnly || c.content === null) continue;
            const cur = await ix(["ls-files", "-s", "--", `:(literal)${c.path}`]);
            const m = /^\d+ ([0-9a-f]+) \d\t/.exec(cur.stdout);
            if (!m) continue;
            // Re-delivery of our own earlier push is not a conflict.
            if (m[1] !== (await hashContent(c.content))) clashes.push(c.path);
          }
          if (clashes.length) {
            conflicted.push(item);
            conflictPaths.push(...clashes);
            continue;
          }
          for (const c of item.entry.changes) {
            if (c.content === null) await ix(["update-index", "--force-remove", "--", c.path]);
            else await ix(["update-index", "--add", "--cacheinfo", `100644,${await hashContent(c.content)},${c.path}`]);
          }
          included.push(item);
        }
        tree = (await ix(["write-tree"])).stdout.trim();
      } finally {
        fs.rmSync(idx, { force: true });
      }

      const settle = (): void => {
        const cdir = path.join(dir, "conflicts");
        const odir = path.join(dir, "outbox");
        if (conflicted.length) fs.mkdirSync(cdir, { recursive: true });
        for (const i of conflicted) fs.renameSync(path.join(odir, i.file), path.join(cdir, i.file));
        for (const i of included) fs.rmSync(path.join(odir, i.file), { force: true });
      };
      const conflictResult = (commit?: string): WriteResult => ({
        result: "conflict",
        ...(commit ? { commit } : {}),
        conflicts: conflictPaths,
        message: `已經有同名檔案，這次的寫入沒有送出：${conflictPaths.join(", ")}`,
      });

      const baseTree = base ? (await git(["rev-parse", `${base}^{tree}`])).stdout.trim() : EMPTY_TREE;
      if (tree === baseTree || included.length === 0) {
        settle();
        return conflicted.length ? conflictResult() : { result: "pushed" };
      }

      const author = await mergeAuthor(included);
      const cenv = {
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
      };
      const ct = await git(["commit-tree", tree, ...(base ? ["-p", base] : []), "-m", commitMessage(included)], {
        env: cenv,
      });
      const sha = ct.stdout.trim();

      const push = await git(["push", remote, `${sha}:refs/heads/${branch}`], { allowFail: true, timeoutMs: NET_TIMEOUT });
      if (push.code === 0) {
        await git(["update-ref", `refs/remotes/${remote}/${branch}`, sha]);
        settle();
        return conflicted.length ? conflictResult(sha) : { result: "pushed", commit: sha };
      }
      const blocked = /protected branch|pre-receive|hook declined|GH006|GH013/i.test(push.stderr);
      if (!blocked && /rejected|fetch first|non-fast-forward/i.test(push.stderr)) continue;
      if (NETWORK_RE.test(push.stderr)) return { result: "offline", message: OFFLINE_MSG };
      throw new TandemError("internal", `git push 失敗：${push.stderr.trim()}`, { stderr: push.stderr });
    }
    return { result: "queued", message: "別人同時在寫入，重試了幾次還是被擋下，稍後會再試。" };
  }

  async function flush(): Promise<WriteResult> {
    if ((await readOutbox()).length === 0) return { result: "pushed" };
    const dir = await tandemDir();
    fs.mkdirSync(dir, { recursive: true });
    return withFileLock(path.join(dir, "lock"), flushLocked);
  }

  return {
    repoRoot,
    kind: "git",
    defaultBranch,
    list,
    read,
    async write(changes, message) {
      for (const c of changes) assertRelPath(c.path);
      if (changes.length === 0) return { result: "pushed" };
      await appendOutbox(changes, message);
      try {
        return await flush();
      } catch (e) {
        if (isNetworkError(e)) return { result: "offline", message: OFFLINE_MSG };
        return { result: "queued", message: e instanceof Error ? e.message : String(e) };
      }
    },
    flush,
    async pending() {
      return (await readOutbox()).length;
    },
    snapshot: remoteSha,
  };
}
