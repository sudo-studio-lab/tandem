import type { AgentKind, AgentStatus } from "@tandem/contracts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import type { AgentAdapter } from "./types.ts";
import { createAcpAdapter } from "./acp.ts";

export const ADAPTERS: Record<AgentKind, AgentAdapter> = { claude: claudeAdapter, codex: codexAdapter, antigravity: createAcpAdapter("antigravity"), grok: createAcpAdapter("grok"), cursor: createAcpAdapter("cursor") };

const TTL_MS = 60_000;
let cache: { at: number; data: Promise<AgentStatus[]>; settled: boolean } | null = null;

/** Install and login state of every agent; checking spawns the agents, so results are cached briefly. */
export function agentStatuses(force = false): Promise<AgentStatus[]> {
  if (cache && (!cache.settled || (!force && Date.now() - cache.at < TTL_MS))) return cache.data;
  const data = Promise.all(Object.values(ADAPTERS).map((a) => a.status()));
  const entry = { at: Date.now(), data, settled: false };
  cache = entry;
  void data.then(() => { entry.settled = true; }, () => { if (cache === entry) cache = null; });
  data.catch(() => (cache = null));
  return data;
}

export type { AgentAdapter } from "./types.ts";
