/**
 * Rooms: the team talks in one place and asks an AI that runs on the host's computer when they
 * need it (「問 AI」). Messages travel through a GitHub Discussion in the private team data repo;
 * the host additionally sees the AI's live work (tools, approvals).
 *
 * One column so it fits an editor side panel: the room list, or one room with a back link.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentKind, Chat, ChatUpdate, Room, RoomMessage, RoomRef } from "@tandem/contracts";
import { api, onAppEvent, projectPath } from "../api.ts";
import { relTime, waitedFor } from "../time.ts";
import { Avatar, MarkdownLite, Spinner, errMsg } from "./ui.tsx";
import { Item, applyUpdate, useAgents, usableAgents } from "./Chat.tsx";
import { Glyph } from "./icons.tsx";
import { PageBar } from "./PageBar.tsx";
import "./room.css";
import { useDraft } from "../drafts.ts";

const POLL_MS = 4000;

function ErrorLine({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <p className="board-error" role="alert">
      <span className="status-dot" aria-hidden="true" />
      <span className="board-error-text">{text}</span>
      <button type="button" className="tb-link" onClick={onDismiss}>
        知道了
      </button>
    </p>
  );
}

export function RoomView({ projectId, me, now, onOpenSettings, onBack }: { projectId: string; me: string; now: number; onOpenSettings: () => void; onBack: () => void }) {
  const [list, setList] = useState<RoomRef[] | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      setList(await api<RoomRef[]>("GET", projectPath(projectId, "/rooms")));
    } catch (e) {
      setError(errMsg(e));
      setList((l) => l ?? []);
    }
  }, [projectId]);

  useEffect(() => {
    setCurrent(null);
    setList(null);
    void loadList();
    const t = setInterval(() => document.visibilityState !== "hidden" && void loadList(), POLL_MS * 4);
    return () => clearInterval(t);
  }, [loadList]);

  const open = list?.filter((r) => !r.closed) ?? [];
  const closed = list?.filter((r) => r.closed) ?? [];

  if (current !== null) {
    return (
      <main className="page board rm">
        {error && <ErrorLine text={error} onDismiss={() => setError(null)} />}
        <RoomPane
          key={current}
          projectId={projectId}
          number={current}
          me={me}
          now={now}
          onError={setError}
          onChanged={loadList}
          onBack={() => {
            setCurrent(null);
            void loadList();
          }}
        />
      </main>
    );
  }

  return (
    <main className="page board rm">
      <PageBar title="房間" onBack={onBack}>
        <button type="button" className="ctl pg-bar-end" aria-expanded={creating} onClick={() => setCreating((c) => !c)}>
          <Glyph name="plus" />
          <span>開房間</span>
        </button>
      </PageBar>
      {error && <ErrorLine text={error} onDismiss={() => setError(null)} />}
      {creating && (
        <NewRoom
          onOpenSettings={onOpenSettings}
          onCancel={() => setCreating(false)}
          onCreate={async (title, agent, model) => {
            const r = await api<Room>("POST", projectPath(projectId, "/rooms"), { title, agent, model });
            setCreating(false);
            setCurrent(r.number);
            void loadList();
          }}
        />
      )}
      {list === null ? (
        <Spinner label="載入房間…" />
      ) : open.length + closed.length === 0 ? (
        !creating && (
          <p className="tb-empty-note">
            還沒有房間。在房間裡可以一起討論，需要時按「問 AI」。
            <button type="button" className="tb-link" onClick={() => setCreating(true)}>
              開一個房間
            </button>
          </p>
        )
      ) : (
        <div className="tb">
          <RoomGroup label="進行中" rooms={open} now={now} me={me} onOpen={setCurrent} />
          {closed.length > 0 && <RoomGroup label="最近結束" rooms={closed} now={now} me={me} onOpen={setCurrent} folded />}
        </div>
      )}
    </main>
  );
}

function RoomGroup({ label, rooms, now, me, onOpen, folded }: { label: string; rooms: RoomRef[]; now: number; me: string; onOpen: (n: number) => void; folded?: boolean }) {
  if (rooms.length === 0) {
    return (
      <div className="tb-group tb-group-empty">
        <div className="tb-sum">
          <span className="tb-chev-space" aria-hidden="true" />
          <span className="tb-group-label">{label}</span>
          <span className="tb-count">0</span>
        </div>
      </div>
    );
  }
  return (
    <details className={`tb-group${folded ? " tb-done-group" : ""}`} open={!folded}>
      <summary className="tb-sum">
        <Glyph name="chevron" size={12} className="tb-chev" />
        <span className="tb-group-label">{label}</span>
        <span className="tb-count">{rooms.length}</span>
      </summary>
      <ul className="tb-rows">
        {rooms.map((r) => (
          <li key={r.number} className="tb-row">
            <button type="button" className="tb-title rm-open" title={r.title} onClick={() => onOpen(r.number)}>
              {r.title}
            </button>
            <span className="tb-meta">
              <span>{r.host.toLowerCase() === me.toLowerCase() ? "你主持" : `@${r.host} 主持`}</span>
              <span>{relTime(r.updatedAt, now)}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function NewRoom(props: { onOpenSettings: () => void; onCancel: () => void; onCreate: (title: string, agent: AgentKind, model: string) => Promise<void> }) {
  const { agents } = useAgents();
  const usable = agents ? usableAgents(agents) : [];
  const options = useMemo(
    () => usable.flatMap((a) => a.models.map((m) => ({ key: `${a.agent}|${m.id}`, label: `${a.label} · ${m.label}`, agent: a.agent, model: m.id }))),
    [usable],
  );
  const [title, setTitle] = useState("");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!options.some((o) => o.key === choice)) setChoice(options[0]?.key ?? "");
  }, [options, choice]);

  if (!agents) return <Spinner label="檢查你登入了哪些 AI…" />;
  const o = options.find((x) => x.key === choice);
  const create = async () => {
    if (!o || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await props.onCreate(title.trim(), o.agent, o.model);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <form
      className="tb-new rm-new"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <label htmlFor="rm-new-title" className="sr-only">
        要討論什麼
      </label>
      <input id="rm-new-title" className="input" value={title} maxLength={80} placeholder="要討論什麼？例如：登入流程要怎麼做" onChange={(e) => setTitle(e.target.value)} autoFocus />
      {usable.length === 0 ? (
        <p className="rm-note">
          你還沒登入任何 AI，沒辦法主持房間，但可以加入別人的房間。{" "}
          <button type="button" className="tb-link" onClick={props.onOpenSettings}>
            登入 AI
          </button>
        </p>
      ) : (
        <label className="rm-field">
          <span>問 AI 時用</span>
          <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {options.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="rm-note">AI 跑在你的電腦、用你的帳號，只有有人按「問 AI」時才回答；要改檔案或跑指令會先問你。房間存在私人的團隊資料 repo。</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="tb-new-actions">
        <button type="button" className="btn btn-small btn-quiet" onClick={props.onCancel}>
          取消
        </button>
        <button type="submit" className="btn btn-small btn-primary" disabled={!o || !title.trim() || busy}>
          {busy ? "建立中…" : "開房間"}
        </button>
      </div>
    </form>
  );
}

function RoomPane({ projectId, number, me, now, onError, onChanged, onBack }: { projectId: string; number: number; me: string; now: number; onError: (m: string) => void; onChanged: () => void; onBack: () => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const { draft, setDraft } = useDraft(`room:${projectId}:${number}:${me}`);
  const text = draft.text;
  const setText = (text: string) => setDraft((current) => ({ ...current, text }));
  const [sending, setSending] = useState<"say" | "ask" | null>(null);
  const [noting, setNoting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const stick = useRef(true);
  const log = useRef<HTMLDivElement>(null);
  const chatId = room?.chatId;
  const isHost = !!chatId;

  const load = useCallback(async () => {
    try {
      setRoom(await api<Room>("GET", projectPath(projectId, `/rooms/${number}`)));
    } catch (e) {
      onError(errMsg(e));
    }
  }, [projectId, number, onError]);

  useEffect(() => {
    void load();
    // A hidden tab doesn't need fresh messages; catch up as soon as it is visible again.
    const t = setInterval(() => document.visibilityState !== "hidden" && void load(), POLL_MS);
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  // Host: the live chat behind the room (tools, approvals, streaming).
  useEffect(() => {
    if (!chatId) return;
    let alive = true;
    void api<Chat>("GET", `/api/chats/${chatId}`).then((c) => alive && setChat(c), (e) => onError(errMsg(e)));
    const off = onAppEvent((e) => {
      if (e.type !== "chat") return;
      const u: ChatUpdate = e.data;
      if (u.chatId === chatId) setChat((c) => (c ? applyUpdate(c, u) : c));
    });
    return () => {
      alive = false;
      off();
    };
  }, [chatId, onError]);

  // The page scrolls; stay at the newest message unless the reader scrolled up.
  useEffect(() => {
    const onScroll = () => {
      const el = document.scrollingElement ?? document.documentElement;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Follow the talk as it grows (new messages and an answer streaming in) unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    const follow = () => {
      if (stick.current) window.scrollTo({ top: document.documentElement.scrollHeight });
    };
    follow();
    const ro = new ResizeObserver(follow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [room !== null]);

  if (!room) return <Spinner label="載入房間…" />;

  const send = async (ask: boolean) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(ask ? "ask" : "say");
    setSendError(null);
    try {
      await api("POST", projectPath(projectId, `/rooms/${number}/messages`), { text: body, ask });
      setText("");
      stick.current = true;
      void load();
    } catch (e) {
      setSendError(`沒送出：${errMsg(e)}。文字還在，可以再試一次。`);
    } finally {
      setSending(null);
    }
  };
  const notes = async (end: boolean) => {
    if (end && !confirm("結束房間？AI 會整理筆記存起來，之後大家就不能再發言。")) return;
    setNoting(true);
    try {
      await api("POST", projectPath(projectId, `/rooms/${number}/notes`), { end });
      void load();
      if (end) setTimeout(onChanged, 3000);
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setNoting(false);
    }
  };
  const running = isHost ? !!chat?.running : !!room.running;
  const hasNotes = !!room.notes && room.notes !== "（還沒有筆記）";
  const loadingChat = isHost && !chat;
  const empty = isHost ? !!chat && chat.items.length === 0 : room.messages.length === 0;
  // A question nobody has answered yet: the newest 「問 AI」 with no AI reply after it.
  const said = isHost && chat
    ? chat.items.flatMap((it) => (it.kind === "user" ? [{ ai: false, ask: !!it.ask, at: it.at }] : it.kind === "assistant" ? [{ ai: true, ask: false, at: it.at }] : []))
    : room.messages.map((m) => ({ ai: m.ai, ask: !!m.ask, at: m.at }));
  let lastAsk = -1;
  said.forEach((m, i) => {
    if (m.ask) lastAsk = i;
  });
  const waiting = lastAsk >= 0 && !said.slice(lastAsk + 1).some((m) => m.ai) ? said[lastAsk]! : null;

  return (
    <div className="rm-room">
      <PageBar back="房間" title={room.title} onBack={onBack}>
        {noting && <span className="rm-busy">AI 整理筆記中…</span>}
        {isHost && !room.closed && (
          <span className="pg-bar-end">
            <button type="button" className="ctl" disabled={noting || running} onClick={() => void notes(false)}>
              整理筆記
            </button>
            <button type="button" className="ctl ctl-bad" disabled={noting || running} onClick={() => void notes(true)}>
              結束
            </button>
          </span>
        )}
      </PageBar>
      <header className="rm-head">
        <p className="rm-sub">
          <span>{isHost ? "你主持・AI 跑在你的電腦" : `@${room.host} 主持・AI 跑在主持人的電腦，回覆會晚幾秒`}</span>
          {room.closed && <span>・已結束</span>}
          <span>・</span>
          <a href={room.url} target="_blank" rel="noreferrer">
            在 GitHub 打開
          </a>
        </p>
      </header>

      <details className="rm-notes" open={room.closed && hasNotes}>
        <summary className="tb-sum">
          <Glyph name="chevron" size={12} className="tb-chev" />
          <span className="tb-group-label">筆記</span>
          <span className="tb-count">{hasNotes ? "" : "還沒有"}</span>
        </summary>
        <div className="rm-notes-body">
          {hasNotes ? (
            <MarkdownLite text={room.notes} />
          ) : (
            <p className="muted">{isHost ? "討論一段後按「整理筆記」，AI 會整理重點、決定和待辦。" : `@${room.host} 按「整理筆記」後會出現在這裡。`}</p>
          )}
        </div>
      </details>

      <div className="rm-log" ref={log} aria-live="polite">
        {loadingChat ? (
          <Spinner label="載入對話…" />
        ) : empty ? (
          <p className="tb-empty-note">還沒有人說話。先說說要討論什麼；需要 AI 時按「問 AI」。</p>
        ) : isHost && chat ? (
          chat.items.map((it) =>
            it.kind === "user" ? (
              <Said key={it.id} by={it.by ?? me} me={me} text={it.text} at={it.at} now={now} ask={!!it.ask} />
            ) : it.kind === "assistant" ? (
              <AiSaid key={it.id} text={it.text} at={it.at} now={now} streaming={it.streaming} />
            ) : (
              <div key={it.id} className="rm-item">
                <Item item={it} chatId={chat.id} onError={onError} />
              </div>
            ),
          )
        ) : (
          room.messages.map((m) => <Message key={m.id} m={m} me={me} now={now} />)
        )}
        {running ? (
          <p className="rm-running">AI 回覆中…</p>
        ) : (
          waiting &&
          !room.closed && (
            <p className="rm-waiting">
              {isHost ? "AI 等一下就會回答" : `等 @${room.host} 的 AI 回覆・${waitedFor(waiting.at, now)}（主持人的 Tandem 要開著）`}
            </p>
          )
        )}
      </div>

      {room.closed ? (
        <p className="rm-closed">房間已經結束，筆記在上面。</p>
      ) : (
        <div className="rm-compose">
          {sendError && (
            <p className="rm-send-error" role="alert">
              {sendError}
            </p>
          )}
          <label htmlFor="rm-text" className="sr-only">
            訊息
          </label>
          <textarea
            id="rm-text"
            className="input"
            rows={2}
            value={text}
            disabled={!!sending}
            placeholder="跟大家說…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                void send(e.ctrlKey || e.metaKey);
              }
            }}
          />
          <div className="rm-compose-row">
            <button type="button" className="btn btn-small" title="只給大家看（Enter）" aria-keyshortcuts="Enter" disabled={!text.trim() || !!sending} onClick={() => void send(false)}>
              {sending === "say" ? "送出中…" : "送出"}
            </button>
            <button type="button" className="btn btn-small btn-primary" title="請 AI 看過討論後回答（Ctrl+Enter）" aria-keyshortcuts="Control+Enter" disabled={!text.trim() || !!sending} onClick={() => void send(true)}>
              {sending === "ask" ? "送出中…" : "問 AI"}
            </button>
          </div>
          <p className="rm-hint">
            <span className="rm-hint-keys">Enter 送出・Ctrl+Enter 問 AI・<span className="rm-hint-shift">Shift+Enter 換行・</span></span>
            只有「問 AI」會叫 AI 回答
          </p>
        </div>
      )}
    </div>
  );
}

function Said({ by, me, text, at, now, ask }: { by: string; me: string; text: string; at: string; now: number; ask: boolean }) {
  const mine = by.toLowerCase() === me.toLowerCase();
  return (
    <div className="rm-msg">
      <div className="rm-who">
        <Avatar login={by} size={16} />
        <span className="rm-name">{mine ? "你" : `@${by}`}</span>
        <span className="rm-time">{relTime(at, now)}</span>
        {ask && <span className="rm-ask">問 AI</span>}
      </div>
      <div className="rm-text">{text}</div>
    </div>
  );
}

function Message({ m, me, now }: { m: RoomMessage; me: string; now: number }) {
  if (!m.ai) return <Said by={m.by} me={me} text={m.text} at={m.at} now={now} ask={!!m.ask} />;
  return <AiSaid text={m.text} at={m.at} now={now} />;
}

function AiSaid({ text, at, now, streaming }: { text: string; at: string; now: number; streaming?: boolean }) {
  return (
    <div className="rm-msg is-ai">
      <div className="rm-who">
        <span className="rm-ai-mark" aria-hidden="true">
          AI
        </span>
        <span className="rm-name">AI</span>
        <span className="rm-time">{relTime(at, now)}</span>
      </div>
      <div className="rm-text">
        <MarkdownLite text={text} />
        {streaming && <span className="caret" aria-hidden="true" />}
      </div>
    </div>
  );
}
