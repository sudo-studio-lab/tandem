import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRODUCT, TandemError, type SyncState } from "@tandem/contracts";
import {
  GitQueue,
  changesSince,
  createSyncScheduler,
  currentBranch,
  fetchRemote,
  findRepoRoot,
  getGitDir,
  getRemoteRepo,
  headCommit,
  installPreCommitHook,
  parseRemoteUrl,
  removePreCommitHook,
  runGit,
  syncData,
} from "./index.ts";
import { makeFixture, write, type Fixture } from "./test-helpers.ts";

const DIR = "tandem";
let fx: Fixture;
beforeEach(async () => {
  fx = await makeFixture();
});
afterEach(() => fx.cleanup());

const status = async (repo: string) => (await runGit(["status", "--porcelain"], { cwd: repo })).stdout;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeout: number): Promise<void> {
  const end = Date.now() + timeout;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    await sleep(50);
  }
}

describe("runGit / queue", () => {
  it("throws TandemError internal on failure unless allowFail", async () => {
    await expect(runGit(["nope-cmd"], { cwd: fx.a })).rejects.toMatchObject({ code: "internal" });
    const r = await runGit(["nope-cmd"], { cwd: fx.a, allowFail: true });
    expect(r.code).not.toBe(0);
  });

  it("GitQueue runs strictly serially and survives failures", async () => {
    const q = new GitQueue();
    const log: string[] = [];
    const p1 = q.run(async () => {
      log.push("1s");
      await sleep(40);
      log.push("1e");
    });
    const p2 = q.run(async () => {
      log.push("2s");
      throw new Error("boom");
    });
    const p3 = q.run(async () => {
      log.push("3s");
      return 3;
    });
    await expect(p2).rejects.toThrow("boom");
    expect(await p3).toBe(3);
    await p1;
    expect(log).toEqual(["1s", "1e", "2s", "3s"]);
  });
});

describe("repo info", () => {
  it("finds root, git dir, branch, head, remote", async () => {
    const sub = path.join(fx.a, "sub");
    fs.mkdirSync(sub);
    expect(await findRepoRoot(sub)).toBe(path.resolve(fx.a));
    expect((await getGitDir(fx.a)).replace(/\\/g, "/")).toMatch(/a\/\.git$/);
    expect(await currentBranch(fx.a)).toBe("main");
    expect(await headCommit(fx.a)).toMatch(/^[0-9a-f]{40}$/);
    await runGit(["remote", "set-url", "origin", "git@github.com:acme/widgets.git"], { cwd: fx.a });
    expect(await getRemoteRepo(fx.a)).toEqual({ owner: "acme", name: "widgets", url: "https://github.com/acme/widgets" });
  });

  it("errors: not a repo, no remote, no commits", async () => {
    await expect(findRepoRoot(fx.root)).rejects.toMatchObject({ code: "not_a_repo" });
    const empty = path.join(fx.root, "empty");
    fs.mkdirSync(empty);
    await runGit(["init"], { cwd: empty });
    expect(await headCommit(empty)).toBeNull();
    await expect(getRemoteRepo(empty)).rejects.toBeInstanceOf(TandemError);
    await expect(getRemoteRepo(empty)).rejects.toMatchObject({ code: "no_remote" });
  });

  it("parses remote URL shapes", () => {
    for (const u of [
      "https://github.com/o/r.git",
      "https://github.com/o/r",
      "https://user@github.com/o/r.git",
      "git@github.com:o/r.git",
      "ssh://git@github.com/o/r.git",
      "ssh://git@github.com:22/o/r.git",
    ]) {
      expect(parseRemoteUrl(u), u).toEqual({ owner: "o", name: "r", url: "https://github.com/o/r" });
    }
    expect(parseRemoteUrl("/local/path")).toBeNull();
  });
});

describe("syncData", () => {
  it("A writes and syncs, B syncs and receives", async () => {
    write(fx.a, `${DIR}/decisions/d1.md`, "one\n");
    const ra = await syncData(fx.a, { dataDir: DIR });
    expect(ra).toMatchObject({ result: "ok", committed: true, pushed: true, pulled: 0 });
    const rb = await syncData(fx.b, { dataDir: DIR });
    expect(rb).toMatchObject({ result: "ok", committed: false, pulled: 1, pushed: false });
    expect(fs.readFileSync(path.join(fx.b, DIR, "decisions/d1.md"), "utf8")).toBe("one\n");
    expect((await syncData(fx.b, { dataDir: DIR })).result).toBe("nothing");
    expect(await status(fx.a)).toBe("");
  });

  it("concurrent writes to different files both succeed", async () => {
    write(fx.a, `${DIR}/status/a.md`, "a\n");
    write(fx.b, `${DIR}/status/b.md`, "b\n");
    const [ra, rb] = await Promise.all([syncData(fx.a, { dataDir: DIR }), syncData(fx.b, { dataDir: DIR })]);
    expect([ra.result, rb.result]).toEqual(["ok", "ok"]);
    await syncData(fx.a, { dataDir: DIR });
    await syncData(fx.b, { dataDir: DIR });
    for (const repo of [fx.a, fx.b]) {
      expect(fs.existsSync(path.join(repo, DIR, "status/a.md"))).toBe(true);
      expect(fs.existsSync(path.join(repo, DIR, "status/b.md"))).toBe(true);
    }
    expect((await runGit(["rev-parse", "HEAD"], { cwd: fx.a })).stdout).toBe(
      (await runGit(["rev-parse", "HEAD"], { cwd: fx.b })).stdout,
    );
  });

  it("same-file edits: second sync reports conflict, repo stays clean, local commit kept", async () => {
    write(fx.a, `${DIR}/team.md`, "base\n");
    await syncData(fx.a, { dataDir: DIR });
    await syncData(fx.b, { dataDir: DIR });
    write(fx.a, `${DIR}/team.md`, "from A\n");
    write(fx.b, `${DIR}/team.md`, "from B\n");
    expect((await syncData(fx.a, { dataDir: DIR })).result).toBe("ok");
    const rb = await syncData(fx.b, { dataDir: DIR, message: "B edit" });
    expect(rb.result).toBe("conflict");
    expect(rb.committed).toBe(true);
    expect(rb.pushed).toBe(false);
    expect(rb.message).toContain("tandem/team.md");
    expect(await status(fx.b)).toBe("");
    expect((await runGit(["log", "-1", "--format=%s"], { cwd: fx.b })).stdout.trim()).toBe("B edit");
    expect(fs.readFileSync(path.join(fx.b, DIR, "team.md"), "utf8")).toBe("from B\n");
    const gd = await getGitDir(fx.b);
    expect(fs.existsSync(path.join(gd, "rebase-merge"))).toBe(false);
    expect(fs.existsSync(path.join(gd, "rebase-apply"))).toBe(false);
  });

  it("leaves unrelated dirty and staged files alone", async () => {
    write(fx.a, `${DIR}/status/a.md`, "a\n");
    await syncData(fx.a, { dataDir: DIR });
    write(fx.b, "README.md", "dirty readme\n");
    write(fx.b, "notes.txt", "untracked\n");
    write(fx.b, "staged.txt", "staged\n");
    await runGit(["add", "staged.txt"], { cwd: fx.b });
    write(fx.b, `${DIR}/status/b.md`, "b\n");
    const r = await syncData(fx.b, { dataDir: DIR });
    expect(r.result).toBe("ok");
    expect(fs.readFileSync(path.join(fx.b, "README.md"), "utf8")).toBe("dirty readme\n");
    expect(fs.readFileSync(path.join(fx.b, "notes.txt"), "utf8")).toBe("untracked\n");
    const st = (await status(fx.b)).split("\n").filter(Boolean).sort();
    expect(st).toEqual(["A  staged.txt", "?? notes.txt", " M README.md"].sort());
    const shown = (await runGit(["show", "--name-only", "--format=", "HEAD"], { cwd: fx.b })).stdout.trim();
    expect(shown).toBe(`${DIR}/status/b.md`);
  });

  it("returns offline when the remote is unreachable, keeping the commit", async () => {
    await runGit(["remote", "set-url", "origin", "https://127.0.0.1:9/x.git"], { cwd: fx.a });
    write(fx.a, `${DIR}/a.md`, "a\n");
    const r = await syncData(fx.a, { dataDir: DIR });
    expect(r).toMatchObject({ result: "offline", committed: true, pushed: false });
    expect(await fetchRemote(fx.a)).toEqual({ result: "offline" });
    expect(await status(fx.a)).toBe("");
  });

  it("pushes a new branch with -u when there is no upstream", async () => {
    await runGit(["checkout", "-b", "feature"], { cwd: fx.a });
    write(fx.a, `${DIR}/a.md`, "a\n");
    const r = await syncData(fx.a, { dataDir: DIR });
    expect(r).toMatchObject({ result: "ok", pushed: true });
    const ls = await runGit(["ls-remote", "--heads", "origin", "feature"], { cwd: fx.a });
    expect(ls.stdout).toContain("refs/heads/feature");
  });

  it("push:false commits but does not push", async () => {
    write(fx.a, `${DIR}/a.md`, "a\n");
    const r = await syncData(fx.a, { dataDir: DIR, push: false });
    expect(r).toMatchObject({ result: "ok", committed: true, pushed: false });
  });
});

describe("changesSince", () => {
  it("lists commits and files for the given paths", async () => {
    const base = (await headCommit(fx.a))!;
    write(fx.a, `${DIR}/decisions/d1.md`, "1\n");
    await syncData(fx.a, { dataDir: DIR, message: "add d1" });
    write(fx.a, "other.txt", "x\n");
    await runGit(["add", "other.txt"], { cwd: fx.a });
    await runGit(["commit", "-m", "other"], { cwd: fx.a });
    const res = await changesSince(fx.a, base, [DIR]);
    expect(res.commits).toHaveLength(1);
    expect(res.commits[0]).toMatchObject({ author: "User A", email: "a@example.com", subject: "add d1" });
    expect(res.files).toEqual([{ path: `${DIR}/decisions/d1.md`, status: "A", commit: res.commits[0]!.sha }]);
  });

  it("falls back to 7 days for null or unknown commits", async () => {
    write(fx.a, `${DIR}/d.md`, "1\n");
    await syncData(fx.a, { dataDir: DIR });
    expect((await changesSince(fx.a, null, [DIR])).commits).toHaveLength(1);
    expect((await changesSince(fx.a, "0".repeat(40), [DIR])).commits).toHaveLength(1);
  });
});

describe("pre-commit hook", () => {
  const hookPath = (repo: string) => path.join(repo, ".git", "hooks", "pre-commit");

  it("creates a hook, replaces only its block, and removes cleanly", async () => {
    await installPreCommitHook(fx.a, "tandem check");
    let text = fs.readFileSync(hookPath(fx.a), "utf8");
    expect(text).toContain(`# BEGIN ${PRODUCT.markerName}`);
    expect(text).toContain("tandem check");
    await installPreCommitHook(fx.a, "tandem check --strict");
    text = fs.readFileSync(hookPath(fx.a), "utf8");
    expect(text.match(/BEGIN/g)).toHaveLength(1);
    expect(text).toContain("--strict");
    await removePreCommitHook(fx.a);
    expect(fs.existsSync(hookPath(fx.a))).toBe(false);
  });

  it("preserves foreign content and the hook actually runs", async () => {
    const foreign = "#!/bin/sh\necho foreign-start\n\necho foreign-end\n";
    fs.writeFileSync(hookPath(fx.a), foreign);
    await installPreCommitHook(fx.a, "exit 1");
    const text = fs.readFileSync(hookPath(fx.a), "utf8");
    expect(text).toContain("echo foreign-start");
    expect(text).toContain("echo foreign-end");
    write(fx.a, "f.txt", "f\n");
    await runGit(["add", "f.txt"], { cwd: fx.a });
    const failing = await runGit(["commit", "-m", "x"], { cwd: fx.a, allowFail: true });
    expect(failing.code).not.toBe(0);
    await installPreCommitHook(fx.a, "true");
    const ok = await runGit(["commit", "-m", "x"], { cwd: fx.a, allowFail: true });
    expect(ok.code).toBe(0);
    await removePreCommitHook(fx.a);
    expect(fs.readFileSync(hookPath(fx.a), "utf8")).toBe(foreign);
  });

  it("respects core.hooksPath", async () => {
    await runGit(["config", "core.hooksPath", ".githooks"], { cwd: fx.a });
    await installPreCommitHook(fx.a, "true");
    expect(fs.existsSync(path.join(fx.a, ".githooks", "pre-commit"))).toBe(true);
    expect(fs.existsSync(hookPath(fx.a))).toBe(false);
  });
});

describe("scheduler", () => {
  it("debounces bursts into one sync, then goes idle", async () => {
    fs.mkdirSync(path.join(fx.a, DIR), { recursive: true });
    const states: SyncState[] = [];
    const s = createSyncScheduler(fx.a, { dataDir: DIR, debounceMs: 400, fetchIntervalMs: 60_000, onState: (x) => states.push(x) });
    try {
      for (let i = 0; i < 3; i++) {
        write(fx.a, `${DIR}/f${i}.md`, `${i}\n`);
        await sleep(60);
      }
      expect(states).toHaveLength(0); // still inside the debounce window
      await waitFor(() => states.some((x) => x.state === "idle"), 15_000);
      const log = (await runGit(["log", "--format=%s", "origin/main"], { cwd: fx.a })).stdout.trim().split("\n");
      expect(log.filter((l) => l === "tandem: update records")).toHaveLength(1);
      expect(states.map((x) => x.state).slice(0, 2)).toEqual(["syncing", "idle"]);
      expect(states.find((x) => x.state === "idle")?.lastSyncAt).toBeTruthy();
    } finally {
      s.stop();
    }
  });

  it("stops auto-syncing after a conflict until trigger()", async () => {
    write(fx.a, `${DIR}/team.md`, "base\n");
    await syncData(fx.a, { dataDir: DIR });
    await syncData(fx.b, { dataDir: DIR });
    write(fx.a, `${DIR}/team.md`, "A\n");
    await syncData(fx.a, { dataDir: DIR });
    write(fx.b, `${DIR}/team.md`, "B\n");
    const states: SyncState[] = [];
    const s = createSyncScheduler(fx.b, { dataDir: DIR, debounceMs: 100, fetchIntervalMs: 60_000, onState: (x) => states.push(x) });
    try {
      s.trigger();
      await waitFor(() => states.some((x) => x.state === "conflict"), 15_000);
      const n = states.length;
      write(fx.b, `${DIR}/other.md`, "o\n");
      await sleep(600);
      expect(states).toHaveLength(n);
      s.trigger();
      await waitFor(() => states.length > n && states.at(-1)?.state === "conflict", 15_000);
    } finally {
      s.stop();
    }
  });
});
