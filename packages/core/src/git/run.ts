import { spawn } from "node:child_process";
import path from "node:path";
import { TandemError } from "@tandem/contracts";

/**
 * Git binary and environment. With TANDEM_GIT (absolute path to dugite's `<gitDir>/cmd/git.exe`)
 * we run the bundled git and set up its environment like dugite's lib/git-environment.ts;
 * otherwise the system `git`.
 */
export function resolveGit(
  parentEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { bin: string; env: Record<string, string> } {
  const bin = parentEnv.TANDEM_GIT?.trim();
  if (!bin) return { bin: "git", env: {} };
  const P = platform === "win32" ? path.win32 : path;
  const gitDir = P.dirname(P.dirname(bin));
  const env: Record<string, string> = {};
  if (platform === "win32") {
    const sub = arch === "x64" ? "ucrt64" : arch === "arm64" ? "clangarm64" : "mingw32";
    const pathKey = Object.keys(parentEnv).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = [path.win32.join(gitDir, sub, "bin"), path.win32.join(gitDir, sub, "usr", "bin"), parentEnv[pathKey] ?? ""].join(";");
    env.GIT_EXEC_PATH = P.join(gitDir, sub, "libexec", "git-core");
  } else {
    env.GIT_EXEC_PATH = path.join(gitDir, "libexec", "git-core");
    env.GIT_CONFIG_SYSTEM = parentEnv.GIT_CONFIG_SYSTEM || path.join(gitDir, "etc", "gitconfig");
  }
  return { bin, env };
}

/**
 * Environment that lets a child git authenticate to GitHub over HTTPS without writing the
 * token to .git/config or the command line. Never log the returned values.
 */
export function gitAuthEnv(token: string, host = "github.com"): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: `http.https://${host}/.extraHeader`,
    GIT_CONFIG_VALUE_1: `Authorization: Basic ${basic}`,
  };
}

export interface RunGitOptions {
  cwd: string;
  env?: Record<string, string>;
  allowFail?: boolean;
  /** Kill the process after this many ms (used for network operations). */
  timeoutMs?: number;
}

export interface RunGitResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Variables that make git ignore `cwd` and use some other repository. Git sets several of them
 * while running hooks (e.g. `tandem check` from pre-commit), so a child git started from there
 * would otherwise act on the hook's repo instead of the one we point it at (for example the
 * separate data repo).
 */
const REPO_LOCATING_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
] as const;

/** process.env without the variables above (case-insensitive: Windows env names are). */
export function inheritedGitEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const drop = new Set<string>(REPO_LOCATING_ENV);
  return Object.fromEntries(Object.entries(parent).filter(([k]) => !drop.has(k.toUpperCase())));
}

/** Run git without a shell. Throws TandemError("internal") on non-zero exit unless allowFail. */
export function runGit(args: string[], opts: RunGitOptions): Promise<RunGitResult> {
  return new Promise((resolve, reject) => {
    const g = resolveGit();
    const child = spawn(g.bin, args, {
      cwd: opts.cwd,
      env: { ...inheritedGitEnv(), ...g.env, ...opts.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, opts.timeoutMs)
      : undefined;
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new TandemError("internal", `無法執行 git：${err.message}`, { args }));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) stderr += "\nOperation timed out";
      const exit = code ?? 1;
      if (exit !== 0 && !opts.allowFail) {
        reject(new TandemError("internal", `git ${args.join(" ")} 失敗：${stderr.trim()}`, { args, code: exit, stderr }));
        return;
      }
      resolve({ stdout, stderr, code: exit });
    });
  });
}
