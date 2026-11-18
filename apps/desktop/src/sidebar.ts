import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

/*
 * The side-panel address: a fixed local port plus a long-lived key, so the board can sit in an
 * editor's built-in browser and keep working after the app restarts or updates. The key lives in
 * this user's app data folder only. It never goes into a log or an error message.
 */

/** First choice of port. Rarely used by other software; the server tries the next few when it is taken. */
export const SIDEBAR_PORT = 47821;

const file = () => path.join(app.getPath("userData"), "sidebar-key");

function write(key: string): void {
  mkdirSync(path.dirname(file()), { recursive: true });
  writeFileSync(file(), key, { encoding: "utf8", mode: 0o600 });
}

/** The current key, made on first use. */
export function sidebarKey(): string {
  try {
    const key = readFileSync(file(), "utf8").trim();
    if (key.length >= 32) return key;
  } catch {
    /* none yet */
  }
  return newSidebarKey();
}

/** Make and save a new key ("換一個網址"). The caller tells the running server. */
export function newSidebarKey(): string {
  const key = randomBytes(32).toString("base64url");
  write(key);
  return key;
}

export function sidebarUrl(origin: string): string {
  return origin ? `${origin}/?t=${sidebarKey()}` : "";
}
