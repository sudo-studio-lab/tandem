import { useEffect, useRef, useState, type RefObject } from "react";
import type { AgentKind, AgentStatus, AppSession, ProjectBoard, ProjectRef } from "@tandem/contracts";
import { api, projectPath } from "../api.ts";
import { relTime } from "../time.ts";
import { errMsg } from "./ui.tsx";

const AGENT_NAME: Record<AgentKind, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", grok: "Grok", cursor: "Cursor" };

/** Top-level screens. Add a tab here and in TABS. */
export type View = "board" | "chat" | "room";
export const TABS: { id: View; label: string }[] = [
  { id: "board", label: "看板" },
  { id: "chat", label: "跟 AI 對話" },
  { id: "room", label: "房間" },
];

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
  view: View;
  onView: (v: View) => void;
  /** Extra tabs (e.g. rooms) appended after TABS. */
  tabs?: { id: View; label: string }[];
}

/** Close a popover on outside click or Escape. */
function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, ref, close]);
}

/** One compact pill: shows the sync state; clicking it refreshes (or retries a failed sync). */
function SyncPill({ board, now, syncing, refreshing, onSync, onRefresh, usable }: Pick<Props, "board" | "now" | "syncing" | "refreshing" | "onSync" | "onRefresh"> & { usable: boolean }) {
  if (!board) return null;
  const s = board.sync;
  const pending = board.pendingWrites > 0 ? ` · ${board.pendingWrites} 筆待同步` : "";
  let tone = "ok";
  let text: string;
  let action = onRefresh;
  let title = "重新整理";
  switch (s.state) {
    case "syncing":
      tone = "info";
      text = "同步中…";
      break;
    case "idle":
      text = `已同步${s.lastSyncAt ? ` · ${relTime(s.lastSyncAt, now)}` : ""}`;
      break;
    case "offline":
      tone = "warn";
      text = "離線，恢復後自動同步";
      break;
    case "conflict":
      tone = "bad";
      text = "同步衝突，需要處理";
      action = onSync;
      title = "重試同步";
      break;
    case "error":
      tone = "bad";
      text = `同步失敗${s.message ? `：${s.message}` : ""}`;
      action = onSync;
      title = "重試同步";
      break;
  }
  if (refreshing) {
    tone = "info";
    text = "更新中…";
  }
  return (
    <button
      type="button"
      role="status"
      className={`sync-pill pill-${tone}`}
      onClick={action}
      disabled={syncing || refreshing || !usable}
      title={`${title}（按一下）`}
    >
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-text">
        {text}
        {pending}
      </span>
      <span className="sync-icon" aria-hidden="true">
        ↻
      </span>
    </button>
  );
}

function Switcher({ session, project, onSelect, onRemove, onAddProject, onError }: Pick<Props, "session" | "project" | "onSelect" | "onRemove" | "onAddProject" | "onError">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const others = session.projects.filter((p) => p.id !== project?.id).reduce((n, p) => n + p.attention, 0);

  return (
    <div className="switcher" ref={ref}>
      <button type="button" className="switcher-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        {project ? (
          <>
            <span className="muted">{project.owner}/</span>
            <strong>{project.name}</strong>
          </>
        ) : (
          <strong>選擇專案</strong>
        )}
        {others > 0 && <span className="dot-badge" aria-label={`其他專案有 ${others} 件事`}>{others}</span>}
        <span aria-hidden="true" className="chev">
          ▾
        </span>
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

/** "⋯" menu: the less frequent actions (terminal, folder, refresh). */
function MoreMenu({ items }: { items: { key: string; label: string; hint?: string; disabled?: boolean; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div className="more-menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label="更多動作" title="更多動作" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        ⋯
      </button>
      {open && (
        <div className="menu menu-right card" role="menu">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              <span className="grow">
                {it.label}
                {it.hint && <span className="block muted small">{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header(p: Props) {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const id = p.project?.id;

  useEffect(() => {
    api<AgentStatus[]>("GET", "/api/agents")
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

  const usable = !!id && !!p.project?.available;
  const tabs = [...TABS, ...(p.tabs ?? [])];
  const more =
    usable && id
      ? [
          ...agents
            .filter((a) => a.installed && a.terminalAvailable !== false)
            .map((a) => ({
              key: a.agent,
              label: `在終端機打開 ${AGENT_NAME[a.agent]}`,
              disabled: opening === a.agent,
              run: () => void run(a.agent, projectPath(id, "/open-agent"), { agent: a.agent }),
            })),
          { key: "folder", label: "打開專案資料夾", disabled: opening === "folder", run: () => void run("folder", projectPath(id, "/open-folder")) },
          { key: "refresh", label: "重新整理看板", disabled: p.refreshing, run: p.onRefresh },
        ]
      : [];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <h1 className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◆
          </span>
          Tandem
        </h1>
        <Switcher {...p} />
        {usable && (
          <nav className="view-tabs" aria-label="畫面">
            {tabs.map((t) => (
              <button key={t.id} type="button" aria-pressed={p.view === t.id} onClick={() => p.onView(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        )}
        <div className="spacer" />
        {p.mock && <span className="pill pill-warn">範例資料</span>}
        {!p.connected && (
          <span className="pill pill-warn" role="status">
            重新連線中…
          </span>
        )}
        <SyncPill board={p.board} now={p.now} syncing={p.syncing} refreshing={p.refreshing} onSync={p.onSync} onRefresh={p.onRefresh} usable={usable} />
        {usable && (
          <button type="button" className="btn btn-small" onClick={p.onInvite}>
            ＋ 邀請
          </button>
        )}
        {more.length > 0 && <MoreMenu items={more} />}
        <button type="button" className="icon-btn" onClick={p.onSettings} aria-label="設定" title="設定">
          ⚙
        </button>
      </div>
    </header>
  );
}
