import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "../git/run.ts";
import { makeFixture, write, type Fixture } from "../git/test-helpers.ts";
import { syncData } from "../git/sync.ts";
import { copyTeamData, dataRepoDir, ensureDataRepo, openGitDataStore, readTandemConfig, resolveDataLocation, writeTandemConfig } from "./index.ts";

let fx: Fixture;
let base: string;
const code = { owner: "o", name: "code", url: "https://github.com/o/code" };
const urlFor = (_owner: string, name: string) => path.join(fx.root, `${name}.git`);

async function bare(name: string): Promise<string> {
  const dir = path.join(fx.root, `${name}.git`);
  fs.mkdirSync(dir);
  await runGit(["init", "--bare", "-q", "-b", "main"], { cwd: dir });
  return dir;
}
const git = async (cwd: string, ...args: string[]) => (await runGit(args, { cwd })).stdout;

beforeEach(async () => {
  fx = await makeFixture();
  base = path.join(fx.root, "app-data");
});
afterEach(() => fx.cleanup());

describe(".tandem.json", () => {
  it("is empty when missing, read from the working tree, else from the remote default branch", async () => {
    expect(await readTandemConfig(fx.a)).toEqual({});

    // B commits it to main; A has not pulled, but has fetched.
    write(fx.b, ".tandem.json", '{ "dataRepo": "o/data" }\n');
    await git(fx.b, "add", ".tandem.json");
    await git(fx.b, "commit", "-m", "config");
    await git(fx.b, "push", "origin", "HEAD:main");
    await git(fx.a, "fetch", "origin");
    expect(fs.existsSync(path.join(fx.a, ".tandem.json"))).toBe(false);
    expect(await readTandemConfig(fx.a)).toEqual({ dataRepo: "o/data" });

    // The working tree copy wins.
    writeTandemConfig(fx.a, { dataRepo: "o/other" });
    expect(await readTandemConfig(fx.a)).toEqual({ dataRepo: "o/other" });
    expect(fs.readFileSync(path.join(fx.a, ".tandem.json"), "utf8")).toBe('{\n  "dataRepo": "o/other"\n}\n');

    write(fx.a, ".tandem.json", '{ "dataRepo": "not a repo" }');
    await expect(readTandemConfig(fx.a)).rejects.toMatchObject({ code: "validation" });
  });

  it("keeps data in the code repo by default (and when dataRepo names the code repo)", async () => {
    expect(await resolveDataLocation(fx.a, code, { baseDir: base })).toEqual({ root: fx.a, repo: code, separate: false });
    write(fx.a, ".tandem.json", '{ "dataRepo": "O/Code" }');
    expect((await resolveDataLocation(fx.a, code, { baseDir: base })).separate).toBe(false);
    expect(fs.existsSync(base)).toBe(false);
  });
});

describe("separate data repo", () => {
  it("sets up a local copy of an empty data repo; the first write creates main", async () => {
    const remote = await bare("data");
    write(fx.a, ".tandem.json", '{ "dataRepo": "O/data" }');
    const loc = await resolveDataLocation(fx.a, code, { baseDir: base, remoteUrlFor: urlFor });
    expect(loc.separate).toBe(true);
    expect(loc.repo).toEqual({ owner: "O", name: "data", url: "https://github.com/O/data" });
    expect(loc.root).toBe(dataRepoDir("O", "data", base));
    expect(path.basename(loc.root)).toBe("o__data");
    expect((await git(loc.root, "remote", "get-url", "origin")).trim()).toBe(remote);

    const store = openGitDataStore(loc.root, { author: { name: "A", email: "a@example.com" } });
    expect(await store.snapshot()).toBeNull();
    expect(await store.list("decisions")).toEqual([]);
    const w = await store.write([{ path: "tandem/decisions/d1.md", content: "one\n", createOnly: true }], "add d1");
    expect(w.result).toBe("pushed");
    expect(await git(remote, "show", "main:tandem/decisions/d1.md")).toBe("one\n");
    expect(await store.read("tandem/decisions/d1.md")).toBe("one\n");
    expect(await store.list("decisions")).toEqual(["d1.md"]);

    // Nothing landed in the code repo.
    expect((await git(fx.remote, "ls-tree", "-r", "--name-only", "main")).trim()).toBe("README.md");
    // The local copy never gets a checkout.
    expect(fs.readdirSync(loc.root)).toEqual([".git"]);

    // Opening again reuses the copy; another computer (another app dir) sees the record.
    expect(await ensureDataRepo("O", "data", { baseDir: base, remoteUrlFor: urlFor })).toBe(loc.root);
    const other = await ensureDataRepo("O", "data", { baseDir: path.join(fx.root, "app-data-2"), remoteUrlFor: urlFor });
    expect(await openGitDataStore(other).read("tandem/decisions/d1.md")).toBe("one\n");
  });

  it("syncData on the data root fetches the data repo only", async () => {
    await bare("data");
    const root = await ensureDataRepo("o", "data", { baseDir: base, remoteUrlFor: urlFor });
    const peer = await ensureDataRepo("o", "data", { baseDir: path.join(fx.root, "peer"), remoteUrlFor: urlFor });
    await openGitDataStore(peer).write([{ path: "tandem/status/bob.md", content: "bob\n" }], "bob");
    const codeBefore = await git(fx.a, "for-each-ref");
    const r = await syncData(root);
    expect(r.pulled).toBe(1);
    expect(await openGitDataStore(root).read("tandem/status/bob.md")).toBe("bob\n");
    expect(await git(fx.a, "for-each-ref")).toBe(codeBefore);
  });

  it("keeps the copy when the data repo is unreachable (offline), to retry later", async () => {
    const url = () => "https://127.0.0.1:1/none.git";
    const dir = await ensureDataRepo("o", "gone", { baseDir: base, remoteUrlFor: url });
    expect(fs.existsSync(path.join(dir, ".git"))).toBe(true);
  });
});

describe("copyTeamData", () => {
  it("copies what is missing as one commit, never overwrites, and is a no-op the second time", async () => {
    const src = openGitDataStore(fx.a);
    await src.write(
      [
        { path: "tandem/decisions/d1.md", content: "d1\n" },
        { path: "tandem/status/a.md", content: "a\n" },
        { path: "tandem/team.md", content: "team\n" },
      ],
      "seed",
    );
    const remote = await bare("data");
    const dest = openGitDataStore(await ensureDataRepo("o", "data", { baseDir: base, remoteUrlFor: urlFor }));
    await dest.write([{ path: "tandem/status/a.md", content: "newer\n" }], "already there");

    const dry = await copyTeamData(src, dest, { dryRun: true });
    expect(dry).toEqual({ copy: ["tandem/decisions/d1.md", "tandem/team.md"], same: [], differ: ["tandem/status/a.md"] });
    expect((await git(remote, "rev-list", "--count", "main")).trim()).toBe("1");

    const r = await copyTeamData(src, dest, { message: "move" });
    expect(r.write?.result).toBe("pushed");
    expect((await git(remote, "rev-list", "--count", "main")).trim()).toBe("2");
    expect(await git(remote, "show", "main:tandem/team.md")).toBe("team\n");
    expect(await git(remote, "show", "main:tandem/status/a.md")).toBe("newer\n");

    const again = await copyTeamData(src, dest);
    expect(again).toEqual({ copy: [], same: ["tandem/decisions/d1.md", "tandem/team.md"], differ: ["tandem/status/a.md"] });
    expect((await git(remote, "rev-list", "--count", "main")).trim()).toBe("2");
  });
});
