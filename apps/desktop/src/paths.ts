import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

/** Repo root in dev (dist/main.cjs → apps/desktop/dist → repo root). */
function repoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

/** Absolute path of the CLI bundle that serves the app and runs agent hooks. */
export function cliPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "cli", "bin.mjs");
  const candidates = [
    process.env.TANDEM_CLI,
    path.join(repoRoot(), "apps", "cli", "dist-desktop", "bin.mjs"),
    path.join(repoRoot(), "apps", "cli", "dist", "bin.js"),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/** Folder of the bundled Git for Windows (dugite). */
export function gitDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "git")
    : path.join(repoRoot(), "node_modules", "dugite", "git");
}

export function gitExe(): string {
  return path.join(gitDir(), "cmd", "git.exe");
}

/** Icon used for the tray and (in dev) the window. */
export function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.resolve(__dirname, "..", "build", "icon.ico");
}
