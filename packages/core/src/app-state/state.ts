import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppSettings } from "@tandem/contracts";

export interface AppProject {
  /** Lower-case "owner/name". */
  id: string;
  owner: string;
  name: string;
  /** Absolute local folder. */
  path: string;
  lastOpenedAt: string;
}

export interface AppStateData {
  version: 1;
  projects: AppProject[];
  currentProjectId: string | null;
  /** Default folder new projects are cloned into. */
  projectsDir: string;
  settings: AppSettings;
  /** Notification ids already shown, oldest first (newest 1000 kept). */
  notified: string[];
}

export const NOTIFIED_LIMIT = 1000;

export function projectIdFor(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase();
}

/** Folder holding app.json: env TANDEM_HOME, else %APPDATA%\Tandem on Windows, else ~/.config/tandem. */
export function appStateDir(): string {
  const home = process.env.TANDEM_HOME?.trim();
  if (home) return path.resolve(home);
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Tandem");
  return path.join(os.homedir(), ".config", "tandem");
}

export function appStatePath(): string {
  return path.join(appStateDir(), "app.json");
}

export function defaultSettings(): AppSettings {
  return { notifications: { waiting: true, review: true, task: true }, openAtLogin: false };
}

export function defaultAppState(): AppStateData {
  return {
    version: 1,
    projects: [],
    currentProjectId: null,
    projectsDir: path.join(os.homedir(), "Tandem"),
    settings: defaultSettings(),
    notified: [],
  };
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Fill gaps and drop malformed entries so a hand-edited or older file never crashes the app. */
function normalize(raw: any): AppStateData {
  const d = defaultAppState();
  if (!raw || typeof raw !== "object") return d;
  const projects: AppProject[] = [];
  for (const p of Array.isArray(raw.projects) ? raw.projects : []) {
    if (!p || !isStr(p.owner) || !isStr(p.name) || !isStr(p.path)) continue;
    projects.push({
      id: projectIdFor(p.owner, p.name),
      owner: p.owner,
      name: p.name,
      path: p.path,
      lastOpenedAt: isStr(p.lastOpenedAt) ? p.lastOpenedAt : new Date(0).toISOString(),
    });
  }
  const n = raw.settings?.notifications ?? {};
  return {
    version: 1,
    projects,
    currentProjectId: isStr(raw.currentProjectId) ? raw.currentProjectId : null,
    projectsDir: isStr(raw.projectsDir) ? raw.projectsDir : d.projectsDir,
    settings: {
      notifications: {
        waiting: typeof n.waiting === "boolean" ? n.waiting : true,
        review: typeof n.review === "boolean" ? n.review : true,
        task: typeof n.task === "boolean" ? n.task : true,
      },
      openAtLogin: typeof raw.settings?.openAtLogin === "boolean" ? raw.settings.openAtLogin : false,
    },
    notified: (Array.isArray(raw.notified) ? raw.notified.filter(isStr) : []).slice(-NOTIFIED_LIMIT),
  };
}

async function readState(): Promise<AppStateData> {
  const file = appStatePath();
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return defaultAppState();
  }
  try {
    return normalize(JSON.parse(text.replace(/^﻿/, "")));
  } catch {
    // Corrupt: keep a copy for the user, start over with defaults.
    try {
      await fs.rename(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      /* best effort */
    }
    return defaultAppState();
  }
}

export async function loadAppState(): Promise<AppStateData> {
  await queue.catch(() => undefined);
  return readState();
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Read-modify-write, serialized within this process. `fn` may mutate the state and return nothing,
 * or return a replacement. Written atomically (temp file + rename). Returns the saved state.
 */
export function updateAppState(fn: (s: AppStateData) => AppStateData | void | Promise<AppStateData | void>): Promise<AppStateData> {
  const run = queue.then(async () => {
    const cur = await readState();
    const next = normalize((await fn(cur)) ?? cur);
    await fs.mkdir(appStateDir(), { recursive: true });
    const file = appStatePath();
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    try {
      await fs.rename(tmp, file);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}
