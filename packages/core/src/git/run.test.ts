import path from "node:path";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { gitAuthEnv, resolveGit, runGit } from "./run.ts";

const dugiteGit = path.resolve(import.meta.dirname, "../../../../node_modules/dugite/git/cmd/git.exe");

describe("gitAuthEnv", () => {
  it("builds the token env without a credential helper", () => {
    const e = gitAuthEnv("tok123");
    expect(e.GIT_TERMINAL_PROMPT).toBe("0");
    expect(e.GIT_CONFIG_COUNT).toBe("2");
    expect(e.GIT_CONFIG_KEY_0).toBe("credential.helper");
    expect(e.GIT_CONFIG_VALUE_0).toBe("");
    expect(e.GIT_CONFIG_KEY_1).toBe("http.https://github.com/.extraHeader");
    expect(e.GIT_CONFIG_VALUE_1).toBe(`Authorization: Basic ${Buffer.from("x-access-token:tok123").toString("base64")}`);
    expect(gitAuthEnv("t", "example.com").GIT_CONFIG_KEY_1).toBe("http.https://example.com/.extraHeader");
  });
});

describe("resolveGit", () => {
  const bin = String.raw`C:\g\cmd\git.exe`;
  it("uses system git without TANDEM_GIT", () => {
    expect(resolveGit({}, "win32", "x64")).toEqual({ bin: "git", env: {} });
  });
  it("derives the bundled environment on Windows", () => {
    const r = resolveGit({ TANDEM_GIT: bin, Path: String.raw`C:\x` }, "win32", "x64");
    expect(r.bin).toBe(bin);
    expect(r.env.Path).toBe(String.raw`C:\g\ucrt64\bin;C:\g\ucrt64\usr\bin;C:\x`);
    expect(r.env.GIT_EXEC_PATH).toBe(String.raw`C:\g\ucrt64\libexec\git-core`);
    expect(resolveGit({ TANDEM_GIT: bin }, "win32", "arm64").env.GIT_EXEC_PATH).toContain("clangarm64");
  });
});

describe.skipIf(process.platform !== "win32" || !existsSync(dugiteGit))("bundled dugite git", () => {
  const old = process.env.TANDEM_GIT;
  afterEach(() => {
    if (old === undefined) delete process.env.TANDEM_GIT;
    else process.env.TANDEM_GIT = old;
  });
  it("runs git --version through runGit", async () => {
    process.env.TANDEM_GIT = dugiteGit;
    const r = await runGit(["--version"], { cwd: process.cwd() });
    expect(r.stdout).toMatch(/^git version \d+\.\d+/);
    const e = await runGit(["--exec-path"], { cwd: process.cwd() });
    expect(e.stdout.trim().toLowerCase()).toContain("dugite");
  });
});

describe("git env isolation", () => {
  it("ignores GIT_DIR and friends inherited from a git hook", async () => {
    const { inheritedGitEnv } = await import("./run.ts");
    const env = inheritedGitEnv({ GIT_DIR: "/x/.git", git_index_file: "/x/index", GIT_WORK_TREE: "/x", PATH: "p", GIT_TERMINAL_PROMPT: "0" });
    expect(env).toEqual({ PATH: "p", GIT_TERMINAL_PROMPT: "0" });
  });

  it("runs in cwd even when GIT_DIR points at another repo", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { runGit } = await import("./run.ts");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-env-"));
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    for (const d of [a, b]) {
      fs.mkdirSync(d);
      await runGit(["init", "-q"], { cwd: d });
    }
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(a, ".git");
    try {
      await runGit(["remote", "add", "origin", "https://example.invalid/b.git"], { cwd: b });
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
    const inA = await runGit(["remote"], { cwd: a });
    const inB = await runGit(["remote"], { cwd: b });
    expect(inA.stdout.trim()).toBe("");
    expect(inB.stdout.trim()).toBe("origin");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
