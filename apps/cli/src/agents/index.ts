import type { AgentKind, AgentStatus } from "@tandem/contracts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import type { AgentAdapter } from "./types.ts";

export const ADAPTERS: Record<AgentKind, AgentAdapter> = { claude: claudeAdapter, codex: codexAdapter };

const TTL_MS = 60_000;
let cache: { at: number; data: Promise<AgentStatus[]> } | null = null;

/** Install and login state of every agent; checking spawns the agents, so results are cached briefly. */
export function agentStatuses(force = false): Promise<AgentStatus[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = Promise.all(Object.values(ADAPTERS).map((a) => a.status()));
  cache = { at: Date.now(), data };
  data.catch(() => (cache = null));
  return data;
}

export type { AgentAdapter } from "./types.ts";
