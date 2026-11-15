import { useEffect, useRef, useState } from "react";
import type { AgentAvailability, AgentKind, AppSession, ProjectBoard, ProjectRef } from "@tandem/contracts";
import { api, projectPath } from "../api.ts";
import { relTime } from "../time.ts";
import { errMsg } from "./ui.tsx";

const AGENT_NAME: Record<AgentKind, string> = { claude: "Claude Code", codex: "Codex" };

interface Props {
  session: AppSession;
  project: ProjectRef | undefined;
  board: ProjectBoard | null;
  now: number;
  mock: boolean;
  connected: boolean;
  refreshing: boolean;
  syncing: boolean;
  onRefresh: () => void;
  onSync: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => Promise<void>;
  onAddProject: () => void;
  onInvite: () => void;
  onSettings: () => void;
  onError: (msg: string) => void;
}

function SyncIndicator({ board, now, syncing, onSync }: Pick<Props, "board" | "now" | "syncing" | "onSync">) {
  if (!board) return null;
  const s = board.sync;
  const retry = (
    <button type="button" className="btn btn-small" onClick={onSync} disabled={syncing}>
      重試同步
    </button>
  );
  const pending =
    board.pendingWrites > 0 ? <span className="pill pill-warn">{board.pendingWrites} 筆等待同步</span> : null;
  let main;
  switch (s.state) {
    case "syncing":
      main = <span className="pill pill-info">同步中…</span>;
      break;
    case "idle":
      main = <span className="pill pill-ok">已同步{s.lastSyncAt ? ` · ${relTime(s.lastSyncAt, now)}` : ""}</span>;
      break;
    case "offline":
      main = <span className="pill pill-warn">離線，恢復後會自動同步</span>;
      break;
    case "conflict":
      main = (
        <span className="sync-problem">
          <span className="pill pill-bad">同步時遇到衝突，需要有人處理</span>
          {retry}
        </span>
      );
      break;
    case "error":
      main = (
        <span className="sync-problem">
          <span className="pill pill-bad">同步失敗{s.message ? `：${s.message}` : ""}</span>
          {retry}
        </span>
      );
      break;
  }
  return (
    <span className="sync-group" role="status">
      {main}
      {pending}
    </span>
  );
}

function Switcher({ session, project, onSelect, onRemove, onAddProject, onError }: Pick<Props, "session" | "project" | "onSelect" | "onRemove" | "onAddProject" | "onError">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const others = session.projects.filter((p) => p.id !== project?.id).reduce((n, p) => n + p.attention, 0);

  return (
    <div className="switcher" ref={ref}>
      <button type="button" className="btn switcher-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        <strong>{project ? `${project.owner}/${project.name}` : "選擇專案"}</strong>
        {others > 0 && <span className="dot-badge" aria-label={`其他專案有 ${others} 件事`}>{others}</span>}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu card">
          <ul>
            {session.projects.map((p) => (
              <li key={p.id} className={`menu-row${p.available ? "" : " is-off"}`}>
                <button
                  type="button"
                  className="menu-item"
                  disabled={!p.available}
                  aria-current={p.id === project?.id ? "true" : undefined}
                  onClick={() => {
                    setOpen(false);
                    onSelect(p.id);
                  }}
                >
                  <span className="grow">
                    {p.owner}/{p.name}
                    {!p.available && <span className="muted small"> 找不到資料夾</span>}
                  </span>
                  {p.attention > 0 && <span className="dot-badge" aria-label={`${p.attention} 件事等你`}>{p.attention}</span>}
                  {p.id === project?.id && <span aria-hidden="true">✓</span>}
                </button>
                {!p.available && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => {
                      onRemove(p.id).catch((e) => onError(errMsg(e)));
                    }}
                  >
                    從清單移除
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="menu-item menu-add"
            onClick={() => {
              setOpen(false);
              onAddProject();
            }}
          >
            ＋ 加入或開始專案
          </button>
        </div>
      )}
    </div>
  );
}

export function Header(p: Props) {
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const id = p.project?.id;

  useEffect(() => {
    api<AgentAvailability[]>("GET", "/api/agents")
      .then(setAgents)
      .catch(() => {});
  }, []);

  async function run(key: string, path: string, body?: unknown) {
    setOpening(key);
    try {
      await api("POST", path, body);
    } catch (e) {
      p.onError(errMsg(e));
    } finally {
      setOpening(null);
    }
  }

  const usable = !!id && p.project?.available;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <h1 className="brand">Tandem</h1>
        <Switcher {...p} />
        <div className="spacer" />
        {p.mock && <span className="pill pill-warn">範例資料</span>}
        {!p.connected && (
          <span className="pill pill-warn" role="status">
            重新連線中…
          </span>
        )}
        <SyncIndicator board={p.board} now={p.now} syncing={p.syncing} onSync={p.onSync} />
        <button type="button" className="btn btn-small" onClick={p.onRefresh} disabled={p.refreshing || !usable}>
          {p.refreshing ? "更新中…" : "重新整理"}
        </button>
        <button type="button" className="btn btn-small" onClick={p.onSettings} aria-label="設定" title="設定">
          ⚙
        </button>
      </div>
      {usable && id && (
        <div className="topbar-inner actions">
          <button type="button" className="btn" onClick={p.onInvite}>
            邀請
          </button>
          {agents.map((a) =>
            a.installed ? (
              <button
                key={a.agent}
                type="button"
                className="btn btn-primary"
                disabled={opening === a.agent}
                onClick={() => run(a.agent, projectPath(id, "/open-agent"), { agent: a.agent })}
              >
                用 {AGENT_NAME[a.agent]} 開始
              </button>
            ) : (
              <a key={a.agent} className="btn btn-quiet" href={a.installUrl} target="_blank" rel="noreferrer">
                還沒安裝 {AGENT_NAME[a.agent]}，點此安裝
              </a>
            ),
          )}
          <button type="button" className="btn" disabled={opening === "folder"} onClick={() => run("folder", projectPath(id, "/open-folder"))}>
            打開資料夾
          </button>
        </div>
      )}
    </header>
  );
}
