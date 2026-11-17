import fs from "node:fs";
import path from "node:path";
import type { SyncState } from "@tandem/contracts";
import { syncData } from "./sync.ts";

export interface SyncSchedulerOptions {
  dataDir: string;
  /** Local repo holding team data (a separate data repo copy); defaults to repoRoot. */
  dataRoot?: string;
  debounceMs?: number;
  fetchIntervalMs?: number;
  onState: (s: SyncState) => void;
}

function newestMtime(dir: string): number {
  let max = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      try {
        const st = fs.statSync(p);
        max = Math.max(max, st.mtimeMs, st.ctimeMs);
        if (e.isDirectory()) walk(p);
      } catch {
        // vanished; the next poll sees the change
      }
    }
  };
  walk(dir);
  return max;
}

export function createSyncScheduler(
  repoRoot: string,
  opts: SyncSchedulerOptions,
): { trigger(): void; stop(): void } {
  const debounceMs = opts.debounceMs ?? 7000;
  const fetchIntervalMs = opts.fetchIntervalMs ?? 60_000;
  const absData = path.resolve(repoRoot, opts.dataDir);
  let stopped = false;
  let conflicted = false;
  let running = false;
  let again = false;
  let lastSyncAt: string | undefined;
  let debounce: NodeJS.Timeout | undefined;

  const last = (): { lastSyncAt?: string } => (lastSyncAt ? { lastSyncAt } : {});
  const emit = (s: SyncState): void => {
    if (!stopped) opts.onState(s);
  };

  function schedule(): void {
    if (stopped || conflicted) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void runSync(), debounceMs);
  }

  async function runSync(): Promise<void> {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    emit({ state: "syncing", ...last() });
    try {
      const r = await syncData(opts.dataRoot ?? repoRoot, { dataDir: opts.dataDir });
      if (r.result === "conflict") {
        conflicted = true;
        if (debounce) clearTimeout(debounce);
        emit({ state: "conflict", message: r.message, ...last() });
      } else if (r.result === "offline") {
        emit({ state: "offline", message: r.message, ...last() });
      } else {
        lastSyncAt = new Date().toISOString();
        emit({ state: "idle", lastSyncAt });
      }
    } catch (err) {
      emit({ state: "error", message: err instanceof Error ? err.message : String(err), ...last() });
    } finally {
      running = false;
      const rerun = again && !conflicted;
      again = false;
      if (rerun) schedule();
    }
  }

  // Watch the data dir; fall back to polling mtimes when recursive watch is unavailable.
  let watcher: fs.FSWatcher | undefined;
  let poller: NodeJS.Timeout | undefined;
  const startPolling = (): void => {
    let prev = newestMtime(absData);
    poller = setInterval(() => {
      const now = newestMtime(absData);
      if (now !== prev) {
        prev = now;
        schedule();
      }
    }, 2000);
    poller.unref();
  };
  try {
    watcher = fs.watch(absData, { recursive: true }, () => schedule());
    watcher.on("error", () => {
      watcher?.close();
      watcher = undefined;
      if (!poller && !stopped) startPolling();
    });
  } catch {
    startPolling();
  }

  const periodic = setInterval(() => {
    if (!conflicted && !running) void runSync();
  }, fetchIntervalMs);
  periodic.unref();

  return {
    trigger() {
      if (stopped) return;
      conflicted = false;
      if (debounce) clearTimeout(debounce);
      void runSync();
    },
    stop() {
      stopped = true;
      if (debounce) clearTimeout(debounce);
      clearInterval(periodic);
      if (poller) clearInterval(poller);
      watcher?.close();
    },
  };
}
