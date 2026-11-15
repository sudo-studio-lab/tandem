import fs from "node:fs";
import { TandemError } from "@tandem/contracts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LockOptions {
  staleMs?: number;
  timeoutMs?: number;
}

/** Cross-process lock file (open with "wx"). Stale after `staleMs`; callers refresh it with `touch`. */
export async function withFileLock<T>(
  lockPath: string,
  fn: (touch: () => void) => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const staleMs = opts.staleMs ?? 60_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  let delay = 30;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now() }));
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw e;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue; // vanished between open and stat: retry immediately
      }
      if (Date.now() > deadline) throw new TandemError("internal", "另一個 Tandem 行程正在同步，等太久了。請稍後再試。");
      await sleep(delay + Math.random() * 30);
      delay = Math.min(delay * 1.6, 300);
    }
  }
  const touch = (): void => {
    try {
      const now = new Date();
      fs.utimesSync(lockPath, now, now);
    } catch {
      // ignore
    }
  };
  try {
    return await fn(touch);
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}
