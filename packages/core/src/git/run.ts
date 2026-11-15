import { spawn } from "node:child_process";
import { TandemError } from "@tandem/contracts";

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

/** Run git without a shell. Throws TandemError("internal") on non-zero exit unless allowFail. */
export function runGit(args: string[], opts: RunGitOptions): Promise<RunGitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
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
