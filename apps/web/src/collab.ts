/**
 * The talk that lives outside the board data: rooms, questions between agents, and shared chats
 * (with the handoffs that ride along). One loader for the whole board so the 對話 tab, the 任務
 * tab (handoffs to you) and the pages behind them read the same copy.
 */
import { useCallback, useEffect, useState } from "react";
import type { AgentMember, AgentMessage, AgentMessageSettings, Handoff, RoomRef, SharedChat, SharedChatSettings } from "@tandem/contracts";
import { api, projectPath } from "./api.ts";
import { errMsg } from "./components/ui.tsx";

export interface AgentMessagesData {
  settings: AgentMessageSettings;
  members: AgentMember[];
  messages: AgentMessage[];
}
export interface SharedData {
  settings: SharedChatSettings;
  chats: SharedChat[];
  handoffs: Handoff[];
}
export interface Collab {
  rooms: RoomRef[] | null;
  agent: AgentMessagesData | null;
  shared: SharedData | null;
  /** The first thing that failed to load, in plain words. */
  error: string | null;
  reload: () => Promise<void>;
}

const POLL_MS = 20_000;

export function useCollab(projectId: string | undefined): Collab {
  const [rooms, setRooms] = useState<RoomRef[] | null>(null);
  const [agent, setAgent] = useState<AgentMessagesData | null>(null);
  const [shared, setShared] = useState<SharedData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    // Each part loads on its own: one failing (e.g. no team data repo yet) doesn't hide the rest.
    const errors: string[] = [];
    const part = async <T,>(path: string, set: (v: T) => void, empty: T) => {
      try {
        set(await api<T>("GET", projectPath(projectId, path)));
      } catch (e) {
        errors.push(errMsg(e));
        set(empty);
      }
    };
    await Promise.all([
      part<RoomRef[]>("/rooms", setRooms, []),
      part<AgentMessagesData | null>("/agent-messages", setAgent, null),
      part<SharedData | null>("/shared-chats", setShared, null),
    ]);
    setError(errors[0] ?? null);
  }, [projectId]);

  useEffect(() => {
    setRooms(null);
    setAgent(null);
    setShared(null);
    setError(null);
    void reload();
    const t = setInterval(() => document.visibilityState !== "hidden" && void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  return { rooms, agent, shared, error, reload };
}

/** Handoffs to you in the last week: they show with what waits on you. */
export function handoffsToMe(shared: SharedData | null, me: string, now: number): Handoff[] {
  const week = 7 * 24 * 3600_000;
  return (shared?.handoffs ?? []).filter((h) => h.to.toLowerCase() === me.toLowerCase() && now - Date.parse(h.at) < week);
}
