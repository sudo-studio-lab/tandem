/** One-time copy of team data (decisions, status, team.md) from one store to another. */
import { PATHS, PRODUCT } from "@tandem/contracts";
import type { DataStore, FileChange, WriteResult } from "./types.ts";

export interface CopyPlan {
  /** Not in the target yet: will be (or were) copied. */
  copy: string[];
  /** Already in the target with the same content. */
  same: string[];
  /** Already in the target with different content: never overwritten. */
  differ: string[];
}

export interface CopyResult extends CopyPlan {
  write?: WriteResult;
}

/** Every team data path in a store, repo-relative. */
async function teamPaths(store: DataStore): Promise<string[]> {
  const [decisions, status, team] = await Promise.all([
    store.list("decisions"),
    store.list("status"),
    store.read(PATHS.team),
  ]);
  return [
    ...decisions.map((n) => `${PATHS.decisions}/${n}`),
    ...status.map((n) => `${PATHS.status}/${n}`),
    ...(team === null ? [] : [PATHS.team]),
  ];
}

/**
 * Copy team data that the target does not have yet, as one commit. Never deletes or overwrites
 * anything in the target, so running it again is a no-op.
 */
export async function copyTeamData(
  source: DataStore,
  target: DataStore,
  opts: { dryRun?: boolean; message?: string } = {},
): Promise<CopyResult> {
  const plan: CopyPlan = { copy: [], same: [], differ: [] };
  const changes: FileChange[] = [];
  for (const p of await teamPaths(source)) {
    const content = await source.read(p);
    if (content === null) continue;
    const there = await target.read(p);
    if (there === null) {
      plan.copy.push(p);
      changes.push({ path: p, content, createOnly: true });
    } else if (there === content) plan.same.push(p);
    else plan.differ.push(p);
  }
  if (opts.dryRun || changes.length === 0) return plan;
  const write = await target.write(changes, opts.message ?? `${PRODUCT.command}: move team data (${changes.length} files)`);
  return { ...plan, write };
}
