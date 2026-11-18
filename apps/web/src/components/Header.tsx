import { useEffect, useRef, useState, type RefObject } from "react";
import type { AgentKind, AgentStatus, AppSession, ProjectBoard, ProjectRef } from "@tandem/contracts";
import { api, projectPath } from "../api.ts";
import { relTime } from "../time.ts";
import { Avatar, errMsg } from "./ui.tsx";
import { Glyph } from "./icons.tsx";

const AGENT_NAME: Record<AgentKind, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", grok: "Grok", cursor: "Cursor" };

/** Top-level screens. Add a tab here and in TABS. */
export type View = "board" | "chat" | "room";

/**
 * Chat stays hidden: you talk to AI in your own editor (D-20261117-qb70). The code stays;
 * set this to true to bring the tab back. Rooms open from the ⋯ menu (D-20261118-8urw).
 */
const SHOW_CHAT = false;

export const TABS: { id: View; label: string }[] = [
  { id: "board", label: "看板" },
  ...(SHOW_CHAT ? [{ id: "chat" as const, label: "跟 AI 對話" }] : []),
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
  /** Open the decisions / discussions / who-waits-on-whom page. */
  onLog?: () => void;
  /** Open the shared context page (脈絡). */
  onContext?: () => void;
  onAgentMessages?: () => void;
  onSharedChats?: () => void;
  onRooms?: () => void;
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

/**
 * One quiet status: a dot plus a few words. Losing the live link to the local
 * Tandem app wins over the last sync result, so the two never contradict each
 * other. Clicking refreshes (or retries a failed sync).
 */
function Status({ board, now, syncing, refreshing, onSync, onRefresh, usable, connected }: Pick<Props, "board" | "now" | "syncing" | "refreshing" | "onSync" | "onRefresh" | "connected"> & { usable: boolean }) {
  let tone: "ok" | "busy" | "warn" | "bad" = "ok";
  let text: string;
  let action: (() => void) | undefined = onRefresh;
  let title = "重新整理";
  if (!connected) {
    tone = "warn";
    text = "連不上本機的 Tandem，重試中…";
    action = undefined;
    title = "等本機的 Tandem 回來";
  } else if (!board) {
    return null;
  } else if (refreshing) {
    tone = "busy";
    text = "更新中…";
  } else {
    const s = board.sync;
    switch (s.state) {
      case "syncing":
        tone = "busy";
        text = "同步中…";
        break;
      case "idle":
        text = `已同步${s.lastSyncAt ? `・${relTime(s.lastSyncAt, now)}` : ""}`;
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
    if (board.pendingWrites > 0) text += `・${board.pendingWrites} 筆待同步`;
  }
  return (
    <button
      type="button"
      className={`status status-${tone}`}
      onClick={action}
      disabled={!action || syncing || refreshing || !usable}
      title={action ? `${text}（按一下${title}）` : `${text}（${title}）`}
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="status-text" aria-live="polite">
        {text}
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
            <span className="muted switcher-owner">{project.owner}/</span>
            <strong className="switcher-name">{project.name}</strong>
          </>
        ) : (
          <strong>選擇專案</strong>
        )}
        {others > 0 && <span className="dot-badge" aria-label={`其他專案有 ${others} 件事`}>{others}</span>}
        <Glyph name="chevron" size={14} className="chev" />
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
  const [position,setPosition]=useState({left:12,top:60});
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const toggle=()=>{if(!open){const rect=ref.current?.getBoundingClientRect();setPosition({left:Math.max(12,Math.min((rect?.right??292)-280,window.innerWidth-292)),top:(rect?.bottom??54)+6});}setOpen(v=>!v);};
  useEffect(()=>{if(!open)return;const resize=()=>{const r=ref.current?.getBoundingClientRect();setPosition({left:Math.max(12,Math.min((r?.right??292)-280,window.innerWidth-292)),top:(r?.bottom??54)+6});};window.addEventListener("resize",resize);return()=>window.removeEventListener("resize",resize);},[open]);
  const collaboration=new Set(["log","context","agent-messages","shared-chats","rooms"]);
  const tools=items.filter(it=>!collaboration.has(it.key)&&!["members","folder","refresh"].includes(it.key));
  const renderItem=(it:typeof items[number])=><button key={it.key} type="button" className="menu-item" disabled={it.disabled} onClick={()=>{setOpen(false);it.run();}}><span className="grow">{it.label}{it.hint&&<span className="block muted small">{it.hint}</span>}</span></button>;
  return (
    <div className="more-menu" ref={ref} onKeyDown={e=>{if(e.key==="Escape"){setOpen(false);ref.current?.querySelector("button")?.focus();}}}>
      <button type="button" className="icon-btn" aria-label="更多動作" title="更多動作" aria-expanded={open} aria-controls="tandem-project-actions" onClick={toggle}>
        <Glyph name="more" />
      </button>
      {open && (
        <div id="tandem-project-actions" className="menu menu-right card co-more-menu" style={{position:"fixed",left:position.left,right:"auto",top:position.top,width:280,minWidth:0,maxHeight:`calc(100dvh - ${position.top+12}px)`,overflowY:"auto"}} role="region" aria-label="專案功能">
          <div role="group" aria-label="協作"><p className="co-menu-heading">協作</p>{items.filter(it=>collaboration.has(it.key)).map(renderItem)}</div>
          {tools.length>0&&<details className="co-menu-tools"><summary>開啟我的 AI 工具</summary>{tools.map(renderItem)}</details>}
          <div role="group" aria-label="專案操作" className="co-menu-project">{items.filter(it=>["members","folder","refresh"].includes(it.key)).map(renderItem)}</div>
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
          ...(p.onLog ? [{ key: "log", label: "決定和討論", hint: "誰在等誰、團隊的決定、討論", run: p.onLog }] : []),
          ...(p.onContext ? [{ key: "context", label: "脈絡", hint: "背景、規格和圖，大家和 AI 都讀得到", run: p.onContext }] : []),
          ...(p.onAgentMessages ? [{ key: "agent-messages", label: "Agent 問答", hint: "閱讀問答、停止或設定開放", run: p.onAgentMessages }] : []),
          ...(p.onSharedChats ? [{ key: "shared-chats", label: "對話與交接", hint: "選擇分享、閱讀隊友對話與交接任務", run: p.onSharedChats }] : []),
          ...(p.onRooms ? [{ key: "rooms", label: "房間", hint: "一起討論，需要時按「問 AI」", run: p.onRooms }] : []),
          ...agents
            .filter((a) => a.installed && a.terminalAvailable !== false)
            .map((a) => ({
              key: a.agent,
              label: `在終端機打開 ${AGENT_NAME[a.agent]}`,
              disabled: opening === a.agent,
              run: () => void run(a.agent, projectPath(id, "/open-agent"), { agent: a.agent }),
            })),
          { key: "members", label: "成員與邀請", run: p.onInvite },
          { key: "folder", label: "打開專案資料夾", disabled: opening === "folder", run: () => void run("folder", projectPath(id, "/open-folder")) },
          { key: "refresh", label: "重新整理看板", disabled: p.refreshing, run: p.onRefresh },
        ]
      : [];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <h1 className="brand" title="Tandem">
          <Glyph name="mark" size={18} className="brand-mark" />
          <span className="brand-name">Tandem</span>
        </h1>
        <Switcher {...p} />
        {usable && tabs.length > 1 && (
          <nav className="view-tabs" aria-label="畫面">
            {tabs.map((t) => (
              <button key={t.id} type="button" aria-pressed={p.view === t.id} onClick={() => p.onView(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        )}
        <div className="spacer" />
        {p.mock && <span className="tag">範例資料</span>}
        <Status board={p.board} now={p.now} syncing={p.syncing} refreshing={p.refreshing} onSync={p.onSync} onRefresh={p.onRefresh} usable={usable} connected={p.connected} />
        {usable && (
          <button
            type="button"
            className="icon-btn topbar-members"
            onClick={p.onInvite}
            aria-label={(p.board?.members.length ?? 0) > 1 ? `${p.board!.members.length} 位成員・邀請與成員` : "邀請隊友"}
            title={(p.board?.members.length ?? 0) > 1 ? `${p.board!.members.length} 位成員` : "邀請隊友"}
          >
            {(p.board?.members.length ?? 0) > 1 ? (
              <span className="topbar-faces" aria-hidden="true">
                {p.board!.members.slice(0, 3).map((m) => (
                  <Avatar key={m.login} login={m.login} size={20} />
                ))}
              </span>
            ) : (
              <span className="topbar-invite">邀請</span>
            )}
          </button>
        )}
        {more.length > 0 && <MoreMenu items={more} />}
        <button type="button" className="icon-btn" onClick={p.onSettings} aria-label="設定" title="設定">
          <Glyph name="settings" />
        </button>
      </div>
    </header>
  );
}
