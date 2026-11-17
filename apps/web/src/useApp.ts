import { useCallback, useEffect, useRef, useState } from "react";
import type { AppEvent, AppSession, ProjectBoard, ProjectProgress } from "@tandem/contracts";
import { api, enableMock, isMock, openEvents, projectPath } from "./api.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useApp() {
  /** undefined = still loading. */
  const [session, setSession] = useState<AppSession | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [board, setBoard] = useState<ProjectBoard | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [mock, setMock] = useState(false);
  const [progress, setProgress] = useState<Record<string, ProjectProgress>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const currentId = session?.currentProjectId ?? null;
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  const loadSession = useCallback(async () => {
    try {
      let s: AppSession;
      try {
        s = await api<AppSession>("GET", "/api/session");
      } catch (e) {
        // `vite` without the local server: fall back to the fake one so the UI is still clickable.
        if (import.meta.env.DEV && !isMock()) {
          await enableMock();
          setMock(true);
          s = await api<AppSession>("GET", "/api/session");
        } else {
          throw e;
        }
      }
      setSession(s);
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e));
    }
  }, []);

  // Start-up: mock or real, then session.
  useEffect(() => {
    void (async () => {
      if (new URLSearchParams(location.search).get("mock") === "1") {
        await enableMock();
        setMock(true);
      }
      await loadSession();
    })();
  }, [loadSession]);

  // Live events, started once we know which backend we talk to.
  const ready = session !== undefined;
  useEffect(() => {
    if (!ready) return;
    return openEvents((e: AppEvent) => {
      switch (e.type) {
        case "session":
          setSession(e.data);
          break;
        case "board":
          if (e.data.projectId === currentIdRef.current) {
            setBoard(e.data);
            setBoardError(null);
          }
          break;
        case "sync":
          setBoard((b) => (b && b.projectId === e.data.projectId ? { ...b, sync: e.data } : b));
          break;
        case "progress":
          setProgress((p) => ({ ...p, [e.data.opId]: e.data }));
          break;
        default:
          break; // notify and ping are for the desktop shell / keep-alive
      }
    }, setConnected);
  }, [ready]);

  // Board of the current project.
  const project = session?.projects.find((p) => p.id === currentId);
  const available = project?.available ?? false;
  const loadBoard = useCallback(async (id: string) => {
    try {
      const b = await api<ProjectBoard>("GET", projectPath(id, "/board"));
      if (currentIdRef.current === id) {
        setBoard(b);
        setBoardError(null);
      }
    } catch (e) {
      if (currentIdRef.current === id) setBoardError(errText(e));
    }
  }, []);
  useEffect(() => {
    setBoard(null);
    setBoardError(null);
    if (currentId && available) void loadBoard(currentId);
  }, [currentId, available, loadBoard]);

  /** Re-read the current board without asking GitHub again (the server already rebuilt it). */
  const reloadBoard = useCallback(async () => {
    const id = currentIdRef.current;
    if (id) await loadBoard(id);
  }, [loadBoard]);

  const refresh = useCallback(async () => {
    const id = currentIdRef.current;
    if (!id) return;
    setRefreshing(true);
    try {
      const b = await api<ProjectBoard>("POST", projectPath(id, "/refresh"));
      if (b && currentIdRef.current === id) setBoard(b);
      setBoardError(null);
    } catch (e) {
      setBoardError(errText(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const sync = useCallback(async () => {
    const id = currentIdRef.current;
    if (!id) return;
    setSyncing(true);
    try {
      await api("POST", projectPath(id, "/sync"));
    } catch (e) {
      setBoardError(errText(e));
    } finally {
      setSyncing(false);
    }
  }, []);

  const selectProject = useCallback(
    async (id: string) => {
      setSession((s) => (s ? { ...s, currentProjectId: id } : s));
      try {
        await api("POST", projectPath(id, "/select"));
      } catch (e) {
        setBoardError(errText(e));
      }
      await loadSession();
    },
    [loadSession],
  );

  const removeProject = useCallback(
    async (id: string) => {
      await api("DELETE", projectPath(id));
      await loadSession();
    },
    [loadSession],
  );

  return {
    session,
    loadError,
    board,
    boardError,
    connected,
    mock,
    progress,
    refreshing,
    syncing,
    loadSession,
    refresh,
    reloadBoard,
    sync,
    selectProject,
    removeProject,
  };
}
