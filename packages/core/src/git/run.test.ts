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
