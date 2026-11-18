import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface DesktopState {
  bounds?: WindowBounds;
  /** The "still running in the tray" hint was shown once. */
  trayHintShown?: boolean;
  /** Version of an update downloaded in an earlier run, installed on the next launch. */
  pendingUpdate?: string;
  /** The "tandem command added to PATH" toast was shown. */
  shimHintShown?: boolean;
  /** The port the server last ran on; tried first next time so the side-panel address stays the same. */
  port?: number;
}

const file = () => path.join(app.getPath("userData"), "desktop-state.json");

export function readState(): DesktopState {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as DesktopState;
  } catch {
    return {};
  }
}

export function writeState(patch: Partial<DesktopState>): void {
  try {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify({ ...readState(), ...patch }, null, 2));
  } catch {}
}
