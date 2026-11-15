/**
 * Rooms (spec 004): the team talks with one AI that runs on the host's computer. Messages travel
 * through a GitHub Discussion; the host additionally sees the AI's live work (tools, approvals).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentKind, Chat, ChatUpdate, Room, RoomMessage, RoomRef } from "@tandem/contracts";
import { api, onAppEvent, projectPath } from "../api.ts";
import { relTime } from "../time.ts";
import { Avatar, Spinner, errMsg } from "./ui.tsx";
import { Item, applyUpdate, useAgents, usableAgents } from "./Chat.tsx";
import "./room.css";

const POLL_MS = 4000;

export function RoomView({ projectId, me, now, onOpenSettings }: { projectId: string; me: string; now: number; onOpenSettings: () => void }) {
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
    const t = setInterval(() => void loadList(), POLL_MS * 4);
    return () => clearInterval(t);
  }, [loadList]);

  const open = list?.filter((r) => !r.closed) ?? [];
  const closed = list?.filter((r) => r.closed) ?? [];
  const showNew = creating || (current === null && list !== null && open.length === 0 && closed.length === 0);

  return (
    <main className="chat-page room-page">
      <aside className="chat-list" aria-label="房間清單">
        <button type="button" className="btn btn-primary chat-new" onClick={() => setCreating(true)}>
          ＋ 開房間
        </button>
        {list === null ? (
          <Spinner label="載入中…" />
        ) : (
          <>
            {open.length > 0 && <p className="room-list-label">進行中</p>}
            <RoomList rooms={open} current={current} now={now} me={me} onOpen={(n) => (setCurrent(n), setCreating(false))} />
            {closed.length > 0 && <p className="room-list-label">最近結束</p>}
            <RoomList rooms={closed} current={current} now={now} me={me} onOpen={(n) => (setCurrent(n), setCreating(false))} />
          </>
        )}
      </aside>
      <section className="chat-main">
        {error && (
          <p className="banner banner-error" role="alert">
            {error}{" "}
            <button type="button" className="btn btn-small" onClick={() => setError(null)}>
              知道了
            </button>
          </p>
        )}
        {showNew ? (
          <NewRoom
            onOpenSettings={onOpenSettings}
            onCancel={current !== null || open.length + closed.length > 0 ? () => setCreating(false) : undefined}
            onCreate={async (title, agent, model) => {
              const r = await api<Room>("POST", projectPath(projectId, "/rooms"), { title, agent, model });
              setCreating(false);
              setCurrent(r.number);
              void loadList();
            }}
          />
        ) : current !== null ? (
          <RoomPane key={current} projectId={projectId} number={current} me={me} now={now} onError={setError} onChanged={loadList} />
        ) : (
          <p className="muted chat-empty">從左邊選一個房間，或開一個新的。</p>
        )}
      </section>
    </main>
  );
}

function RoomList({ rooms, current, now, me, onOpen }: { rooms: RoomRef[]; current: number | null; now: number; me: string; onOpen: (n: number) => void }) {
  return (
    <ul>
      {rooms.map((r) => (
        <li key={r.number}>
          <button type="button" className={`chat-list-item${r.number === current ? " is-current" : ""}${r.closed ? " is-closed" : ""}`} onClick={() => onOpen(r.number)}>
            <span className="chat-list-title">{r.title}</span>
            <span className="muted small">
              {r.host === me ? "你主持" : `@${r.host} 主持`} · {relTime(r.updatedAt, now)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NewRoom(props: { onOpenSettings: () => void; onCancel?: () => void; onCreate: (title: string, agent: AgentKind, model: string) => Promise<void> }) {
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
    <div className="card pad chat-setup room-setup">
      <h2>開一個房間</h2>
      <p className="muted">
        隊友都能進來一起跟 AI 討論。AI 跑在<strong>你的電腦</strong>、用你的帳號；它要改檔案或跑指令時會先問你。房間的對話存在 GitHub
        Discussions，結束時 AI 會整理成筆記。
      </p>
      <label className="chat-field">
        <span>要討論什麼</span>
        <input className="input" value={title} maxLength={80} placeholder="例如：登入流程要怎麼做" onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      {usable.length === 0 ? (
        <p className="banner banner-warn">
          你還沒登入任何 AI，沒辦法主持房間（但可以加入別人的房間）。{" "}
          <button type="button" className="btn-link" onClick={props.onOpenSettings}>
            登入 AI
          </button>
        </p>
      ) : (
        <label className="chat-field">
          <span>用哪一個 AI</span>
          <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {options.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="banner banner-error">{error}</p>}
      <div className="row-end">
        {props.onCancel && (
          <button type="button" className="btn" onClick={props.onCancel}>
            取消
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={!o || !title.trim() || busy} onClick={() => void create()}>
          {busy ? "建立中…" : "開房間"}
        </button>
      </div>
    </div>
  );
}

function RoomPane({ projectId, number, me, now, onError, onChanged }: { projectId: string; number: number; me: string; now: number; onError: (m: string) => void; onChanged: () => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [noting, setNoting] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
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
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
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

  const count = isHost ? chat?.items.length : room?.messages.length;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  if (!room) return <Spinner label="載入房間…" />;

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await api("POST", projectPath(projectId, `/rooms/${number}/messages`), { text: body });
      setText("");
      stick.current = true;
      void load();
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setSending(false);
    }
  };
  const notes = async (end: boolean) => {
    if (end && !confirm("結束房間？AI 會整理筆記存到 GitHub，之後大家就不能再發言。")) return;
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
  const running = isHost ? !!chat?.running : false;

  return (
    <div className="room">
      <div className="chat chat-room">
        <div className="chat-head room-head">
          <div className="room-title">
            <strong>{room.title}</strong>
            <span className="room-meta">
              <span className={`room-host${isHost ? " is-me" : ""}`}>{isHost ? "你主持 · AI 跑在你的電腦" : `@${room.host} 主持 · AI 跑在主持人的電腦`}</span>
              {room.closed && <span className="pill">已結束</span>}
              <a className="muted small" href={room.url} target="_blank" rel="noreferrer">
                在 GitHub 打開 ↗
              </a>
            </span>
          </div>
          {isHost && !room.closed && (
            <div className="room-actions">
              <button type="button" className="btn btn-small" disabled={noting || running} onClick={() => void notes(false)}>
                整理筆記
              </button>
              <button type="button" className="btn btn-small btn-danger" disabled={noting || running} onClick={() => void notes(true)}>
                結束房間
              </button>
            </div>
          )}
        </div>
        <div
          className="chat-scroll"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {isHost && chat ? (
            chat.items.length === 0 ? (
              <EmptyRoom />
            ) : (
              chat.items.map((it) =>
                it.kind === "user" ? (
                  <Said key={it.id} by={it.by ?? me} me={me} text={it.text} at={it.at} now={now} />
                ) : it.kind === "assistant" ? (
                  <AiSaid key={it.id} text={it.text} at={it.at} now={now} streaming={it.streaming} />
                ) : (
                  <Item key={it.id} item={it} chatId={chat.id} onError={onError} />
                ),
              )
            )
          ) : room.messages.length === 0 ? (
            <EmptyRoom />
          ) : (
            room.messages.map((m) => <Message key={m.id} m={m} me={me} now={now} />)
          )}
          {running && <p className="msg-notice muted small">AI 回覆中…</p>}
        </div>
        {room.closed ? (
          <p className="muted small room-closed">房間已經結束。筆記在右邊，也存在 GitHub。</p>
        ) : (
          <div className="chat-compose">
            <textarea
              className="input"
              rows={2}
              value={text}
              placeholder={isHost ? "跟大家和 AI 說…（Enter 送出，Shift+Enter 換行）" : `跟大家和 AI 說…AI 跑在 @${room.host} 的電腦，回覆會晚幾秒`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="button" className="btn btn-primary" disabled={!text.trim() || sending} onClick={() => void send()}>
              送出
            </button>
          </div>
        )}
      </div>
      <aside className="room-notes" aria-label="筆記">
        <h3>筆記</h3>
        {room.notes && room.notes !== "（還沒有筆記）" ? (
          <Notes text={room.notes} />
        ) : (
          <p className="muted small">{isHost ? "討論一段後按「整理筆記」，AI 會整理重點、決定和待辦。" : `@${room.host} 按「整理筆記」後會出現在這裡。`}</p>
        )}
        {noting && <Spinner label="整理中…" />}
      </aside>
    </div>
  );
}

function EmptyRoom() {
  return <p className="muted chat-empty">還沒有人說話。先說說要討論什麼吧。</p>;
}

function Said({ by, me, text, at, now }: { by: string; me: string; text: string; at: string; now: number }) {
  const mine = by.toLowerCase() === me.toLowerCase();
  return (
    <div className={`room-msg${mine ? " is-me" : ""}`}>
      <Avatar login={by} size={30} />
      <div className="room-msg-body">
        <span className="room-msg-who">
          {mine ? "你" : `@${by}`} <span className="muted small">{relTime(at, now)}</span>
        </span>
        <div className="msg msg-user">{text}</div>
      </div>
    </div>
  );
}

function Message({ m, me, now }: { m: RoomMessage; me: string; now: number }) {
  if (!m.ai) return <Said by={m.by} me={me} text={m.text} at={m.at} now={now} />;
  return <AiSaid text={m.text} at={m.at} now={now} />;
}

function AiSaid({ text, at, now, streaming }: { text: string; at: string; now: number; streaming?: boolean }) {
  return (
    <div className="room-msg is-ai">
      <span className="avatar-ai" aria-hidden="true">
        AI
      </span>
      <div className="room-msg-body">
        <span className="room-msg-who">
          AI <span className="muted small">{relTime(at, now)}</span>
        </span>
        <div className="msg msg-assistant">
          {text}
          {streaming && <span className="caret" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}

/** Just enough Markdown for the notes: headings and bullets. */
function Notes({ text }: { text: string }) {
  return (
    <div className="notes">
      {text.split("\n").map((line, i) => {
        const h = /^#{1,6}\s+(.*)$/.exec(line);
        if (h) return <h4 key={i}>{h[1]}</h4>;
        const li = /^\s*[-*]\s+(.*)$/.exec(line);
        if (li) return <p key={i} className="notes-li">{li[1]}</p>;
        return line.trim() ? <p key={i}>{line}</p> : null;
      })}
    </div>
  );
}
