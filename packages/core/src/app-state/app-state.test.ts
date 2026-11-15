import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appStatePath, loadAppState, projectIdFor, updateAppState } from "./index.ts";

let dir: string;
const old = process.env.TANDEM_HOME;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "tandem-home-"));
  process.env.TANDEM_HOME = dir;
});
afterEach(() => {
  if (old === undefined) delete process.env.TANDEM_HOME;
  else process.env.TANDEM_HOME = old;
  rmSync(dir, { recursive: true, force: true });
});

describe("app-state", () => {
  it("projectIdFor lower-cases owner/name", () => {
    expect(projectIdFor("Sudo-Studio-Lab", "Tandem")).toBe("sudo-studio-lab/tandem");
  });

  it("returns defaults when the file is missing", async () => {
    const s = await loadAppState();
    expect(s).toMatchObject({
      version: 1,
      projects: [],
      currentProjectId: null,
      notified: [],
      settings: { notifications: { waiting: true, review: true, task: true }, openAtLogin: false },
    });
    expect(s.projectsDir).toBe(path.join(os.homedir(), "Tandem"));
  });

  it("persists updates atomically (no temp files left)", async () => {
    await updateAppState((s) => {
      s.projects.push({ id: "x", owner: "Acme", name: "Proj", path: "C:\\p", lastOpenedAt: "2026-11-15T00:00:00Z" });
      s.currentProjectId = "acme/proj";
    });
    const s = await loadAppState();
    expect(s.projects[0]).toMatchObject({ id: "acme/proj", owner: "Acme" });
    expect(s.currentProjectId).toBe("acme/proj");
    expect(readdirSync(dir)).toEqual(["app.json"]);
  });

  it("serializes concurrent updates", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => updateAppState((s) => void s.notified.push(`n${i}`))));
    const s = await loadAppState();
    expect(s.notified).toEqual(Array.from({ length: 20 }, (_, i) => `n${i}`));
  });

  it("keeps only the newest 1000 notified ids", async () => {
    await updateAppState((s) => {
      s.notified = Array.from({ length: 1200 }, (_, i) => `n${i}`);
    });
    const s = await loadAppState();
    expect(s.notified).toHaveLength(1000);
    expect(s.notified[0]).toBe("n200");
    expect(s.notified.at(-1)).toBe("n1199");
  });

  it("backs up a corrupt file and starts from defaults", async () => {
    writeFileSync(appStatePath(), "{ not json");
    const s = await loadAppState();
    expect(s.projects).toEqual([]);
    const files = readdirSync(dir);
    expect(files.some((f) => f.startsWith("app.json.corrupt-"))).toBe(true);
    expect(files).not.toContain("app.json");
    await updateAppState((x) => void (x.settings.openAtLogin = true));
    expect(JSON.parse(readFileSync(appStatePath(), "utf8")).settings.openAtLogin).toBe(true);
  });

  it("tolerates partial or malformed content", async () => {
    writeFileSync(appStatePath(), JSON.stringify({ projects: [{ owner: "a" }, { owner: "A", name: "B", path: "p" }], settings: { notifications: { task: false } } }));
    const s = await loadAppState();
    expect(s.projects.map((p) => p.id)).toEqual(["a/b"]);
    expect(s.settings.notifications).toEqual({ waiting: true, review: true, task: false });
  });
});
