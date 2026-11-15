import fs from "node:fs";
import path from "node:path";
import { PRODUCT } from "@tandem/contracts";
import { getGitDir } from "../git/index.ts";

export interface LocalState {
  version: 1;
  lastBrief?: { commit: string | null; time: string };
  etags?: Record<string, { etag: string; body: unknown; savedAt: string }>;
  login?: string;
  discussionsCursor?: string;
}

const defaultState = (): LocalState => ({ version: 1 });

async function stateFile(repoRoot: string): Promise<string> {
  return path.join(await getGitDir(repoRoot), PRODUCT.localStateDir, "state.json");
}

/** Missing or corrupt file gives the default state; a corrupt file is moved to state.json.bak. */
export async function readLocalState(repoRoot: string): Promise<LocalState> {
  const file = await stateFile(repoRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return defaultState();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as { version?: unknown }).version === 1) {
      return parsed as LocalState;
    }
  } catch {
    // fall through to quarantine
  }
  try {
    fs.renameSync(file, `${file}.bak`);
  } catch {
    // best effort
  }
  return defaultState();
}

/** Atomic write: temp file in the same folder, then rename. */
export async function writeLocalState(repoRoot: string, state: LocalState): Promise<void> {
  const file = await stateFile(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

const chains = new Map<string, Promise<unknown>>();

/** Read-modify-write, serialized per repo within this process. */
export function updateLocalState(
  repoRoot: string,
  fn: (s: LocalState) => LocalState | void,
): Promise<LocalState> {
  const key = path.resolve(repoRoot);
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev
    .catch(() => undefined)
    .then(async () => {
      const cur = await readLocalState(repoRoot);
      const next = fn(cur) ?? cur;
      await writeLocalState(repoRoot, next);
      return next;
    });
  chains.set(key, run);
  return run;
}
