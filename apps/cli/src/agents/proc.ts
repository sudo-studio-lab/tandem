import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Env for the agent process: ours minus the Electron switch (the agent is not Electron). */
export function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * Resolve how to run a command. The native Claude build is an .exe and runs directly; npm installs
 * are .cmd shims, which Node can only start through cmd.exe.
 */
export function resolveCommand(cmd: string): { file: string; prefix: string[] } | null {
  if (path.isAbsolute(cmd) && existsSync(cmd)) {
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd)) return { file: process.env.ComSpec || "cmd.exe", prefix: [cmd] };
    return { file: cmd, prefix: [] };
  }
  if (process.platform !== "win32") {
    const r = spawnSync("which", [cmd], { encoding: "utf8" });
    return r.status === 0 ? { file: cmd, prefix: [] } : null;
  }
  const r = spawnSync("where", [cmd], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return null;
  const hits = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const exe = hits.find((h) => /\.exe$/i.test(h));
  if (exe) return { file: exe, prefix: [] };
  const cmdShim = hits.find((h) => /\.(cmd|bat)$/i.test(h));
  if (cmdShim) return { file: process.env.ComSpec || "cmd.exe", prefix: [cmdShim] };
  return null;
}

/** Quote one argument for cmd.exe /s /c (only used for paths and our own fixed flags). */
function quoteCmd(a: string): string {
  return /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}

export function spawnAgent(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): ChildProcess {
  const r = resolveCommand(cmd);
  if (!r) throw new Error(`找不到 ${cmd}`);
  // cmd.exe /s strips the outer quotes, so the whole line goes inside one more pair.
  const finalArgs = r.prefix.length ? ["/d", "/s", "/c", `"${[...r.prefix, ...args].map(quoteCmd).join(" ")}"`] : args;
  return spawn(r.file, finalArgs, {
    cwd: opts.cwd,
    env: opts.env ?? agentEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    windowsVerbatimArguments: r.prefix.length > 0,
  });
}

/** Run to completion and capture output (for version / status checks). */
export function runCapture(cmd: string, args: string[], timeoutMs = 15_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnAgent(cmd, args, { cwd: process.cwd() });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: (e as Error).message });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdin?.end();
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    const t = setTimeout(() => killTree(child), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: null, stdout, stderr: stderr || e.message });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Kill a process and its children (on Windows this is how a turn is stopped). */
export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

/** Calls `onLine` for each complete stdout line. */
export function onLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buf = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.trim()) onLine(line);
    }
  });
}

/** Open a visible terminal running `args` in `cwd` (agent logins that need a real terminal). */
export function openTerminal(cwd: string, args: string[]): void {
  const detached = { detached: true, stdio: "ignore" as const, windowsHide: false, env: agentEnv() };
  if (process.platform === "win32") {
    const wt = spawnSync("where", ["wt"], { stdio: "ignore", windowsHide: true }).status === 0;
    if (wt) {
      spawn("wt.exe", ["-d", cwd, ...args], detached).unref();
      return;
    }
    // Each argument is passed separately; nothing from the user is interpolated into the script.
    spawn("powershell.exe", ["-NoExit", "-Command", "Set-Location -LiteralPath $args[0]; & $args[1] @($args[2..($args.Length-1)])", cwd, ...args], detached).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", ["-a", "Terminal", cwd], detached).unref();
    return;
  }
  throw new Error("這個系統還不支援從 app 打開終端機");
}
