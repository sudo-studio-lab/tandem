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
import { openGitDataStore } from "../data/index.ts";
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
  const writeFileThrough = async (repo: string, rel: string, content: string, message = "tandem: update records") =>
    openGitDataStore(repo).write([{ path: rel, content }], message);
  const remoteLog = async () =>
    (await runGit(["log", "--format=%s", "main"], { cwd: fx.remote })).stdout.trim().split("\n");

  it("flushes the outbox to the remote default branch and fetches for others", async () => {
    const store = openGitDataStore(fx.a);
    // Queue without flushing: simulate a writer that could not push.
    await runGit(["remote", "set-url", "origin", path.join(fx.root, "nowhere.git")], { cwd: fx.a });
    expect((await store.write([{ path: `${DIR}/decisions/d1.md`, content: "one\n" }], "add d1")).result).toBe("offline");
    expect((await syncData(fx.a, { dataDir: DIR })).result).toBe("offline");
    await runGit(["remote", "set-url", "origin", fx.remote], { cwd: fx.a });
    const ra = await syncData(fx.a, { dataDir: DIR });
    expect(ra).toMatchObject({ result: "ok", committed: true, pushed: true });
    const rb = await syncData(fx.b, { dataDir: DIR });
    expect(rb).toMatchObject({ result: "ok", committed: false, pulled: 1, pushed: false });
    expect(await openGitDataStore(fx.b).read(`${DIR}/decisions/d1.md`)).toBe("one\n");
    expect((await syncData(fx.b, { dataDir: DIR })).result).toBe("nothing");
    expect(await remoteLog()).toContain("add d1");
  });

  it("never touches the user's branch, index or working tree", async () => {
    await runGit(["checkout", "-b", "feature"], { cwd: fx.b });
    write(fx.b, "code.ts", "x\n");
    await runGit(["add", "."], { cwd: fx.b });
    await runGit(["commit", "-m", "code"], { cwd: fx.b });
    write(fx.b, "wip.txt", "wip\n");
    await writeFileThrough(fx.a, `${DIR}/status/a.md`, "a\n");
    const headBefore = (await runGit(["rev-parse", "HEAD"], { cwd: fx.b })).stdout;
    const r = await syncData(fx.b, { dataDir: DIR });
    expect(r.result).toBe("ok");
    expect((await runGit(["rev-parse", "HEAD"], { cwd: fx.b })).stdout).toBe(headBefore);
    expect(await status(fx.b)).toBe("?? wip.txt\n");
    expect(fs.existsSync(path.join(fx.b, DIR))).toBe(false);
    const heads = (await runGit(["ls-remote", "--heads", "origin"], { cwd: fx.b })).stdout;
    expect(heads).not.toMatch(/feature/);
  });

  it("returns offline when the remote is unreachable", async () => {
    await runGit(["remote", "set-url", "origin", "https://127.0.0.1:9/x.git"], { cwd: fx.a });
    expect((await syncData(fx.a, { dataDir: DIR })).result).toBe("offline");
    expect(await fetchRemote(fx.a)).toEqual({ result: "offline" });
  });

  it("reports a createOnly clash as conflict", async () => {
    const p = `${DIR}/decisions/same.md`;
    await openGitDataStore(fx.a).write([{ path: p, content: "A\n", createOnly: true }], "a");
    const r = await openGitDataStore(fx.b).write([{ path: p, content: "B\n", createOnly: true }], "b");
    expect(r.result).toBe("conflict");
    expect(r.conflicts).toEqual([p]);
  });
});

describe("changesSince", () => {
  it("lists remote default-branch commits and files, ignoring the checkout", async () => {
    const base = (await headCommit(fx.a))!;
    await openGitDataStore(fx.a).write([{ path: `${DIR}/decisions/d1.md`, content: "1\n" }], "add d1");
    write(fx.a, "other.txt", "x\n");
    await runGit(["add", "other.txt"], { cwd: fx.a });
    await runGit(["commit", "-m", "other"], { cwd: fx.a });
    const res = await changesSince(fx.a, base, [DIR]);
    expect(res.commits).toHaveLength(1);
    expect(res.commits[0]).toMatchObject({ author: "User A", email: "a@example.com", subject: "add d1" });
    expect(res.files).toEqual([{ path: `${DIR}/decisions/d1.md`, status: "A", commit: res.commits[0]!.sha }]);
    // The unpushed local commit is invisible; an explicit ref still works.
    expect((await changesSince(fx.a, base, [], "HEAD")).commits.map((c) => c.subject)).toEqual(["other"]);
  });

  it("falls back to 7 days for null or unknown commits", async () => {
    await openGitDataStore(fx.a).write([{ path: `${DIR}/d.md`, content: "1\n" }], "d");
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
  it("syncs on trigger() and goes idle", async () => {
    await openGitDataStore(fx.b).write([{ path: `${DIR}/status/b.md`, content: "b\n" }], "b status");
    const states: SyncState[] = [];
    const s = createSyncScheduler(fx.a, { dataDir: DIR, debounceMs: 100, fetchIntervalMs: 60_000, onState: (x) => states.push(x) });
    try {
      s.trigger();
      await waitFor(() => states.some((x) => x.state === "idle"), 15_000);
      expect(states.map((x) => x.state).slice(0, 2)).toEqual(["syncing", "idle"]);
      expect(states.find((x) => x.state === "idle")?.lastSyncAt).toBeTruthy();
      expect(await openGitDataStore(fx.a).read(`${DIR}/status/b.md`)).toBe("b\n");
    } finally {
      s.stop();
    }
  });

  it("reports offline without throwing", async () => {
    await runGit(["remote", "set-url", "origin", path.join(fx.root, "nowhere.git")], { cwd: fx.a });
    const states: SyncState[] = [];
    const s = createSyncScheduler(fx.a, { dataDir: DIR, debounceMs: 100, fetchIntervalMs: 60_000, onState: (x) => states.push(x) });
    try {
      s.trigger();
      await waitFor(() => states.some((x) => x.state === "offline"), 15_000);
    } finally {
      s.stop();
    }
  });
});
