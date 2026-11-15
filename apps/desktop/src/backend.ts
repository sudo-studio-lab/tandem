import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, existsSync, mkdirSync, statSync, truncateSync, type WriteStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ServeReadyLine } from "@tandem/contracts";

export interface BackendOptions {
  cliPath: string;
  gitExe: string;
  logDir: string;
  token: string;
}

const READY_TIMEOUT_MS = 30_000;
const KILL_WAIT_MS = 5_000;

function isReady(v: unknown): v is ServeReadyLine {
  const o = v as Partial<ServeReadyLine> | null;
  return !!o && o.ready === true && typeof o.port === "number" && typeof o.url === "string";
}

/**
 * Runs `tandem serve` as a child process (Electron's own exe in node mode) and restarts it
 * when it dies. Events: "ready" (ServeReadyLine), "down" (reason: string).
 */
export class Backend extends EventEmitter {
  port = 0;
  private child: ChildProcess | null = null;
  private stopping = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;
  private log: WriteStream;

  constructor(private opts: BackendOptions) {
    super();
    mkdirSync(opts.logDir, { recursive: true });
    const file = path.join(opts.logDir, "server.log");
    try {
      if (existsSync(file) && statSync(file).size > 5_000_000) truncateSync(file, 0);
    } catch {}
    this.log = createWriteStream(file, { flags: "a" });
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  note(msg: string): void {
    this.log.write(`[${new Date().toISOString()}] [desktop] ${msg}\n`);
  }

  start(): void {
    this.stopping = false;
    this.launch();
  }

  private launch(): void {
    if (!existsSync(this.opts.cliPath)) {
      this.note(`CLI bundle not found: ${this.opts.cliPath}`);
      this.emit("down", `找不到 Tandem 伺服器檔案：${this.opts.cliPath}`);
      this.scheduleRestart(true);
      return;
    }
    const startedAt = Date.now();
    this.note(`starting ${this.opts.cliPath}`);
    const child = spawn(
      process.execPath,
      [this.opts.cliPath, "serve", "--port", "0", "--token-stdin", "--desktop"],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          TANDEM_GIT: this.opts.gitExe,
          TANDEM_DESKTOP: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.child = child;
    let ready = false;
    const readyTimer = setTimeout(() => {
      if (!ready) {
        this.note("timed out waiting for ready line; killing");
        child.kill();
      }
    }, READY_TIMEOUT_MS);

    child.stdin?.on("error", () => {});
    child.stdin?.write(this.opts.token + "\n");

    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (!ready) {
        try {
          const parsed: unknown = JSON.parse(line);
          if (isReady(parsed)) {
            ready = true;
            clearTimeout(readyTimer);
            this.port = parsed.port;
            this.note(`ready on port ${parsed.port}`);
            this.emit("ready", parsed);
            return;
          }
        } catch {}
      }
      this.log.write(line + "\n");
    });
    createInterface({ input: child.stderr! }).on("line", (line) => this.log.write(`[err] ${line}\n`));

    child.on("error", (e) => this.note(`spawn error: ${e.message}`));
    child.on("exit", (code, signal) => {
      clearTimeout(readyTimer);
      if (this.child === child) this.child = null;
      this.note(`exited code=${code} signal=${signal}`);
      if (this.stopping) return;
      if (Date.now() - startedAt > 30_000) this.attempt = 0;
      this.emit("down", `伺服器已停止（code ${code ?? signal}）`);
      this.scheduleRestart();
    });
  }

  private scheduleRestart(missingFile = false): void {
    if (this.stopping || this.timer) return;
    const delay = Math.min(10_000, 500 * 2 ** this.attempt);
    this.attempt = missingFile ? Math.max(this.attempt, 4) : this.attempt + 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopping) this.launch();
    }, delay);
  }

  /** Kill the child and wait (up to 5 s) for it to exit. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, KILL_WAIT_MS);
        child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
        child.kill();
      });
    }
    this.log.end();
  }
}
