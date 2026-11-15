import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "../git/run.ts";
import { makeFixture, write, type Fixture } from "../git/test-helpers.ts";
import { openFsDataStore, openGitDataStore } from "./index.ts";

let fx: Fixture;
beforeEach(async () => {
  fx = await makeFixture();
});
afterEach(() => fx.cleanup());

const git = async (cwd: string, ...args: string[]) => (await runGit(args, { cwd })).stdout;
const remoteFile = async (rel: string) => git(fx.remote, "show", `main:${rel}`);

/** Everything about a checkout that a background writer must not change. */
async function fingerprint(repo: string) {
  const gitDir = path.resolve(repo, (await git(repo, "rev-parse", "--git-dir")).trim());
  return {
    head: await git(repo, "rev-parse", "HEAD"),
    branch: await git(repo, "symbolic-ref", "HEAD"),
    refs: await git(repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"),
    indexBytes: fs.readFileSync(path.join(gitDir, "index")).toString("base64"),
    cached: await git(repo, "diff", "--cached"),
    unstaged: await git(repo, "diff"),
    status: await git(repo, "status", "--porcelain=v2", "--branch"),
    tree: fs
      .readdirSync(repo)
      .filter((n) => n !== ".git")
      .sort()
      .map((n) => `${n}=${fs.readFileSync(path.join(repo, n), "utf8")}`),
  };
}

describe("git data store", () => {
  it("writes to origin/main without touching a dirty feature-branch checkout", async () => {
    await git(fx.a, "checkout", "-b", "feature");
    write(fx.a, "code.ts", "committed\n");
    await git(fx.a, "add", "code.ts");
    await git(fx.a, "commit", "-m", "unpushed code");
    write(fx.a, "staged.txt", "staged\n");
    await git(fx.a, "add", "staged.txt");
    write(fx.a, "README.md", "hello\nlocal edit\n");
    const before = await fingerprint(fx.a);

    const store = openGitDataStore(fx.a);
    const r = await store.write([{ path: "tandem/status/alice.md", content: "alice\n" }], "tandem: update status");
    expect(r.result).toBe("pushed");
    expect(r.commit).toMatch(/^[0-9a-f]{40}$/);

    expect(await remoteFile("tandem/status/alice.md")).toBe("alice\n");
    expect((await git(fx.remote, "log", "-1", "--format=%s%n%an <%ae>", "main")).trim()).toBe(
      "tandem: update status\nUser A <a@example.com>",
    );
    expect(await git(fx.remote, "rev-parse", "main")).toContain(r.commit!);
    expect(await git(fx.remote, "branch", "--list")).not.toMatch(/feature/);
    expect(await fingerprint(fx.a)).toEqual(before);
    expect(fs.existsSync(path.join(fx.a, "tandem"))).toBe(false);

    expect(await store.read("tandem/status/alice.md")).toBe("alice\n");
    expect(await store.list("status")).toEqual(["alice.md"]);
    expect(await store.snapshot()).toBe(r.commit);
    expect(await store.pending()).toBe(0);
    expect(await store.defaultBranch()).toBe("main");
  });

  it("two clones writing different files both land on main", async () => {
    const sa = openGitDataStore(fx.a);
    const sb = openGitDataStore(fx.b);
    const [ra, rb] = await Promise.all([
      sa.write([{ path: "tandem/status/a.md", content: "a\n" }], "a"),
      sb.write([{ path: "tandem/status/b.md", content: "b\n" }], "b"),
    ]);
    expect([ra.result, rb.result]).toEqual(["pushed", "pushed"]);
    expect(await remoteFile("tandem/status/a.md")).toBe("a\n");
    expect(await remoteFile("tandem/status/b.md")).toBe("b\n");
    // Linear history: init + two commits.
    expect((await git(fx.remote, "rev-list", "--count", "main")).trim()).toBe("3");
  });

  it("rebuilds after a rejected push (remote moved between fetch and push)", async () => {
    // A's local view is stale; the fetch inside flush brings it up to date.
    await openGitDataStore(fx.b).write([{ path: "tandem/status/b.md", content: "b\n" }], "b");
    const r = await openGitDataStore(fx.a).write([{ path: "tandem/status/a.md", content: "a\n" }], "a");
    expect(r.result).toBe("pushed");
    expect(await remoteFile("tandem/status/b.md")).toBe("b\n");
    expect(await remoteFile("tandem/status/a.md")).toBe("a\n");
  });

  it("queues while offline, serves reads from the outbox, then flushes", async () => {
    const store = openGitDataStore(fx.a);
    await runGit(["remote", "set-url", "origin", path.join(fx.root, "missing.git")], { cwd: fx.a });
    const r = await store.write([{ path: "tandem/decisions/d1.md", content: "one\n" }], "add d1");
    expect(r.result).toBe("offline");
    expect(await store.pending()).toBe(1);
    expect(await store.read("tandem/decisions/d1.md")).toBe("one\n");
    expect(await store.list("decisions")).toEqual(["d1.md"]);
    expect((await store.flush()).result).toBe("offline");

    await runGit(["remote", "set-url", "origin", fx.remote], { cwd: fx.a });
    const f = await store.flush();
    expect(f.result).toBe("pushed");
    expect(await store.pending()).toBe(0);
    expect(await remoteFile("tandem/decisions/d1.md")).toBe("one\n");
  });

  it("treats createOnly on an existing path as a conflict and keeps it out of the commit", async () => {
    const p = "tandem/decisions/x.md";
    expect((await openGitDataStore(fx.a).write([{ path: p, content: "first\n", createOnly: true }], "first")).result).toBe(
      "pushed",
    );
    const sb = openGitDataStore(fx.b);
    const r = await sb.write([{ path: p, content: "second\n", createOnly: true }], "second");
    expect(r.result).toBe("conflict");
    expect(r.conflicts).toEqual([p]);
    expect(await sb.pending()).toBe(0);
    expect(await remoteFile(p)).toBe("first\n");
    const dir = path.resolve(fx.b, (await git(fx.b, "rev-parse", "--git-path", "tandem/conflicts")).trim());
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it("creates the default branch on an empty remote", async () => {
    const empty = path.join(fx.root, "empty.git");
    fs.mkdirSync(empty);
    await runGit(["init", "--bare", "-b", "main"], { cwd: empty });
    const clone = path.join(fx.root, "c");
    await runGit(["clone", empty, clone], { cwd: fx.root });
    await runGit(["config", "user.name", "C"], { cwd: clone });
    await runGit(["config", "user.email", "c@example.com"], { cwd: clone });
    const store = openGitDataStore(clone);
    expect(await store.snapshot()).toBeNull();
    expect(await store.list("status")).toEqual([]);
    const r = await store.write([{ path: "tandem/status/c.md", content: "c\n" }], "first");
    expect(r.result).toBe("pushed");
    expect((await git(empty, "show", "main:tandem/status/c.md"))).toBe("c\n");
    expect((await git(empty, "rev-list", "--count", "main")).trim()).toBe("1");
  });

  it("deletes files and ignores writes identical to the remote", async () => {
    const store = openGitDataStore(fx.a);
    await store.write([{ path: "tandem/status/a.md", content: "a\n" }], "add");
    const same = await store.write([{ path: "tandem/status/a.md", content: "a\n" }], "again");
    expect(same).toEqual({ result: "pushed" });
    const del = await store.write([{ path: "tandem/status/a.md", content: null }], "rm");
    expect(del.result).toBe("pushed");
    expect(await store.read("tandem/status/a.md")).toBeNull();
    expect(await store.list("status")).toEqual([]);
  });

  it("two store instances flushing in parallel do not corrupt anything", async () => {
    await runGit(["remote", "set-url", "origin", path.join(fx.root, "missing.git")], { cwd: fx.a });
    const s1 = openGitDataStore(fx.a);
    const s2 = openGitDataStore(fx.a);
    for (let i = 0; i < 3; i++) {
      await s1.write([{ path: `tandem/status/p${i}.md`, content: `${i}\n` }], `p${i}`);
    }
    await s2.write([{ path: "tandem/status/q.md", content: "q\n" }], "q");
    await runGit(["remote", "set-url", "origin", fx.remote], { cwd: fx.a });
    const results = await Promise.all([s1.flush(), s2.flush(), s1.flush()]);
    expect(results.map((r) => r.result)).toEqual(["pushed", "pushed", "pushed"]);
    expect(await s1.pending()).toBe(0);
    for (const n of ["p0", "p1", "p2", "q"]) expect((await remoteFile(`tandem/status/${n}.md`)).length).toBeGreaterThan(0);
    // No temporary index or blob files left behind, no lock left behind.
    const dir = path.resolve(fx.a, (await git(fx.a, "rev-parse", "--git-path", "tandem")).trim());
    expect(fs.readdirSync(dir).filter((n) => n.startsWith("index-") || n.startsWith("blob-") || n === "lock")).toEqual([]);
    await git(fx.remote, "fsck");
  });

  it("recovers from a stale lock", async () => {
    const dir = path.resolve(fx.a, (await git(fx.a, "rev-parse", "--git-path", "tandem")).trim());
    fs.mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, "lock");
    fs.writeFileSync(lock, "{}");
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(lock, old, old);
    const r = await openGitDataStore(fx.a).write([{ path: "tandem/status/a.md", content: "a\n" }], "a");
    expect(r.result).toBe("pushed");
  });

  it("works in a linked worktree and with core.hooksPath set", async () => {
    await git(fx.a, "config", "core.hooksPath", ".githooks");
    const wt = path.join(fx.root, "wt");
    await git(fx.a, "worktree", "add", "-b", "wt-branch", wt);
    const store = openGitDataStore(wt);
    const r = await store.write([{ path: "tandem/status/w.md", content: "w\n" }], "w");
    expect(r.result).toBe("pushed");
    expect(await remoteFile("tandem/status/w.md")).toBe("w\n");
  });

  it("passes gitEnv to git calls", async () => {
    const store = openGitDataStore(fx.a, { gitEnv: { GIT_AUTHOR_NAME: "ignored-by-commit-tree" }, author: { name: "Zed", email: "z@example.com" } });
    await store.write([{ path: "tandem/status/z.md", content: "z\n" }], "z");
    expect((await git(fx.remote, "log", "-1", "--format=%an <%ae>", "main")).trim()).toBe("Zed <z@example.com>");
  });

  it("rejects unsafe paths", async () => {
    const store = openGitDataStore(fx.a);
    await expect(store.write([{ path: "../evil.md", content: "x" }], "x")).rejects.toMatchObject({ code: "validation" });
    await expect(store.read("/etc/passwd")).rejects.toMatchObject({ code: "validation" });
  });
});

describe("fs data store", () => {
  it("reads, lists, writes, deletes and flags createOnly clashes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-fs-"));
    try {
      const s = openFsDataStore(root);
      expect(await s.list("decisions")).toEqual([]);
      expect(await s.read("tandem/decisions/a.md")).toBeNull();
      expect((await s.write([{ path: "tandem/decisions/a.md", content: "a\n", createOnly: true }], "m")).result).toBe("pushed");
      expect(await s.list("decisions")).toEqual(["a.md"]);
      expect(await s.read("tandem/decisions/a.md")).toBe("a\n");
      const c = await s.write([{ path: "tandem/decisions/a.md", content: "b\n", createOnly: true }], "m");
      expect(c.result).toBe("conflict");
      expect(await s.read("tandem/decisions/a.md")).toBe("a\n");
      await s.write([{ path: "tandem/decisions/a.md", content: null }], "m");
      expect(await s.list("decisions")).toEqual([]);
      expect(await s.pending()).toBe(0);
      expect(await s.snapshot()).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
