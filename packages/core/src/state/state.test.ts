import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGitDir, runGit } from "../git/index.ts";
import { makeFixture, type Fixture } from "../git/test-helpers.ts";
import { readLocalState, updateLocalState, writeLocalState } from "./index.ts";

let fx: Fixture;
beforeEach(async () => {
  fx = await makeFixture();
});
afterEach(() => fx.cleanup());

describe("local state", () => {
  it("defaults when missing, round-trips, lives under .git", async () => {
    expect(await readLocalState(fx.a)).toEqual({ version: 1 });
    await writeLocalState(fx.a, { version: 1, login: "alice", lastBrief: { commit: null, time: "t" } });
    expect(await readLocalState(fx.a)).toMatchObject({ login: "alice" });
    const file = path.join(await getGitDir(fx.a), "tandem", "state.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect((await runGit(["status", "--porcelain"], { cwd: fx.a })).stdout).toBe("");
  });

  it("renames a corrupt file to state.json.bak and returns defaults", async () => {
    const file = path.join(await getGitDir(fx.a), "tandem", "state.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    expect(await readLocalState(fx.a)).toEqual({ version: 1 });
    expect(fs.existsSync(`${file}.bak`)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("updateLocalState serializes concurrent updates", async () => {
    await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        updateLocalState(fx.a, (s) => ({ ...s, etags: { ...s.etags, [`k${i}`]: { etag: String(i), body: i, savedAt: "t" } } })),
      ),
    );
    expect(Object.keys((await readLocalState(fx.a)).etags ?? {}).sort()).toEqual(["k1", "k2", "k3", "k4", "k5"]);
  });
});
