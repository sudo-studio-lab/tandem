import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardData, SyncState } from "@tandem/contracts";
import { mockBoard } from "./mock.ts";

export interface InviteResult {
  invited: string;
  status: "invited" | "already";
  shareText: string;
}

const wantsMock = () => new URLSearchParams(location.search).get("mock") === "1";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export function useBoard() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [mock, setMock] = useState(wantsMock);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const mockRef = useRef(mock);
  mockRef.current = mock;

  useEffect(() => {
    if (mock) {
      setBoard(mockBoard());
      setError(null);
      return;
    }
    let es: EventSource | undefined;
    let cancelled = false;
    api<BoardData>("/api/board")
      .then((b) => {
        if (cancelled) return;
        setBoard(b);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (import.meta.env.DEV) {
          setMock(true); // API unreachable in dev: fall back to the fixture.
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    if (typeof EventSource !== "undefined") {
      es = new EventSource("/api/events");
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false); // EventSource reconnects by itself.
      es.addEventListener("board", (ev) => {
        try {
          setBoard(JSON.parse((ev as MessageEvent<string>).data) as BoardData);
          setError(null);
        } catch {
          /* ignore malformed event */
        }
      });
      es.addEventListener("sync", (ev) => {
        try {
          const sync = JSON.parse((ev as MessageEvent<string>).data) as SyncState;
          setBoard((b) => (b ? { ...b, sync } : b));
        } catch {
          /* ignore malformed event */
        }
      });
    }
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [mock]);

  const refresh = useCallback(async () => {
    if (mockRef.current) return;
    setRefreshing(true);
    try {
      setBoard(await api<BoardData>("/api/refresh", { method: "POST" }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const sync = useCallback(async () => {
    if (mockRef.current) return;
    setSyncing(true);
    try {
      const s = await api<SyncState>("/api/sync", { method: "POST" });
      setBoard((b) => (b ? { ...b, sync: s } : b));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, []);

  const invite = useCallback(async (login: string): Promise<InviteResult> => {
    if (mockRef.current) {
      return {
        invited: login,
        status: "invited",
        shareText: `${login}，我邀請你加入我們的專案。請先接受 GitHub 邀請，再依照說明安裝並加入。`,
      };
    }
    return api<InviteResult>("/api/invite", { method: "POST", body: JSON.stringify({ login }) });
  }, []);

  return { board, error, connected, mock, refreshing, syncing, refresh, sync, invite };
}
