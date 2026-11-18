/**
 * Rooms: the team talks in one place and asks an AI that runs on the host's computer when they
 * need it (「問 AI」). Messages travel through a GitHub Discussion in the private team data repo;
 * the host additionally sees the AI's live work (tools, approvals).
 *
 * One column so it fits an editor side panel: the room list, or one room with a back link.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentKind, Chat, ChatSummary, ChatUpdate, Room, RoomMessage } from "@tandem/contracts";
import { api, onAppEvent, projectPath } from "../api.ts";
import { relTime, waitedFor } from "../time.ts";
import { Avatar, MarkdownLite, Spinner, errMsg } from "./ui.tsx";
import { Item, applyUpdate, useAgents, usableAgents } from "./Chat.tsx";
import { useDismiss } from "./Header.tsx";
import { Glyph } from "./icons.tsx";
import { PageBar } from "./PageBar.tsx";
import "./room.css";
import { useDraft } from "../drafts.ts";

const POLL_MS = 4000;
const AI_NAME: Record<AgentKind, string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity", grok: "Grok", cursor: "Cursor" };

/**
 * Text an AI drafted and a person posted starts with "🤖 Codex:" (often bolded). The person stays
 * the author; the tool becomes a small note next to their name.
 */
export function splitDrafter(text: string): { drafter: string; text: string } {
  const m = /^\s*(?:\*\*)?\s*🤖\s*([^\n:：*]{1,30}?)\s*(?:\*\*)?\s*[:：]\s*(?:\*\*)?[ \t]*\n*/.exec(text);
  return m ? { drafter: m[1]!.trim(), text: text.slice(m[0].length) } : { drafter: "", text };
}

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

/**
 * One room (`room` is its number), or the form that opens a new one ("new"). The list of rooms
 * lives in the 對話 tab with the rest of the talk; back returns there.
 */
export function RoomView({ projectId, me, now, room, back, onOpenSettings, onBack, onChanged }: { projectId: string; me: string; now: number; room: number | "new"; back?: string; onOpenSettings: () => void; onBack: () => void; onChanged: () => void }) {
  const [current, setCurrent] = useState<number | null>(room === "new" ? null : room);
  const [error, setError] = useState<string | null>(null);

  if (current !== null) {
    return (
      <main className="page board rm">
        {error && <ErrorLine text={error} onDismiss={() => setError(null)} />}
        <RoomPane key={current} projectId={projectId} number={current} me={me} now={now} back={back} onError={setError} onChanged={onChanged} onBack={onBack} />
      </main>
    );
  }

  return (
    <main className="page board rm">
      <PageBar back={back} title="開房間" onBack={onBack} />
      {error && <ErrorLine text={error} onDismiss={() => setError(null)} />}
      <NewRoom
        onOpenSettings={onOpenSettings}
        onCancel={onBack}
        onCreate={async (title, agent, model) => {
          const r = await api<Room>("POST", projectPath(projectId, "/rooms"), { title, agent, model });
          setCurrent(r.number);
          onChanged();
        }}
      />
    </main>
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

function RoomPane({ projectId, number, me, now, back, onError, onChanged, onBack }: { projectId: string; number: number; me: string; now: number; back?: string; onError: (m: string) => void; onChanged: () => void; onBack: () => void }) {
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

  const hostActions = isHost && !room.closed;
  const busy = noting || running;
  // Guests learn who answers from the newest AI reply ("Codex · gpt-5.1 · high").
  const lastLabel = room.messages.filter((m) => m.ai && m.label).at(-1)?.label;
  // The opening message carries the agenda and the newest answer is what people read: both stay whole.
  const shown = isHost && chat ? chat.items.map((it) => ({ id: it.id, user: it.kind === "user", ai: it.kind === "assistant" })) : room.messages.map((m) => ({ id: m.id, user: !m.ai, ai: m.ai }));
  const firstUserId = shown.find((m) => m.user)?.id;
  const lastAiId = shown.filter((m) => m.ai).at(-1)?.id;

  return (
    <div className="rm-room">
      <PageBar back={back} title={room.title} onBack={onBack}>
        <span className="pg-bar-end">
          {noting && <span className="rm-busy">AI 整理筆記中…</span>}
          <RoomMenu
            items={[
              ...(hostActions ? [{ key: "notes", label: hasNotes ? "更新筆記" : "整理筆記", disabled: busy, run: () => void notes(false) }] : []),
              { key: "github", label: "在 GitHub 打開", href: room.url },
              ...(hostActions ? [{ key: "end", label: "結束房間", bad: true, disabled: busy, run: () => void notes(true) }] : []),
            ]}
          />
        </span>
      </PageBar>

      {hasNotes && (
        <details className="rm-notes" open={room.closed}>
          <summary className="tb-sum">
            <Glyph name="chevron" size={12} className="tb-chev" />
            <span className="tb-group-label">筆記</span>
          </summary>
          <div className="rm-notes-body">
            <MarkdownLite text={room.notes} />
          </div>
        </details>
      )}

      <div className="rm-log" ref={log}>
        {loadingChat ? (
          <Spinner label="載入對話…" />
        ) : empty ? (
          <p className="tb-empty-note">還沒有人說話。先說說要討論什麼；需要 AI 時按「問 AI」。</p>
        ) : isHost && chat ? (
          chat.items.map((it) =>
            it.kind === "user" ? (
              <Said key={it.id} by={it.by ?? me} me={me} text={it.text} at={it.at} now={now} ask={!!it.ask} clamp={it.id !== firstUserId} />
            ) : it.kind === "assistant" ? (
              <AiSaid key={it.id} name={AI_NAME[chat.agent]} text={it.text} at={it.at} now={now} streaming={it.streaming} clamp={it.id !== lastAiId} />
            ) : (
              <div key={it.id} className="rm-item">
                <Item item={it} chatId={chat.id} onError={onError} />
              </div>
            ),
          )
        ) : (
          room.messages.map((m) => <Message key={m.id} m={m} me={me} now={now} clamp={m.id !== (m.ai ? lastAiId : firstUserId)} />)
        )}
        <div role="status">
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
      </div>

      {room.closed ? (
        <p className="rm-closed">{hasNotes ? "房間已經結束，筆記在上面。" : "房間已經結束。"}</p>
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
              // On touch keyboards Enter is a new line; the two buttons send.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && !matchMedia("(pointer: coarse)").matches) {
                e.preventDefault();
                void send(e.ctrlKey || e.metaKey);
              }
            }}
          />
          <div className="rm-compose-row">
            {isHost && chat ? (
              <AiPicker chat={chat} onChanged={(s) => setChat((c) => (c ? { ...c, ...s } : c))} onError={onError} />
            ) : (
              <span className="rm-ai-line" title="問 AI 時回答的 AI">
                <span className="rm-ai-mark" aria-hidden="true">
                  AI
                </span>
                <span className="rm-ai-text">{isHost ? "載入中…" : `@${room.host} 的 ${lastLabel ?? "AI"}`}</span>
              </span>
            )}
            <span className="rm-compose-actions">
              <button type="button" className="btn btn-small" title="只給大家看，AI 不會回（Enter）" aria-keyshortcuts="Enter" disabled={!text.trim() || !!sending} onClick={() => void send(false)}>
                {sending === "say" ? "送出中…" : "送出"}
              </button>
              <button type="button" className="btn btn-small btn-primary" title="請 AI 看過討論後回答（Ctrl+Enter）" aria-keyshortcuts="Control+Enter" disabled={!text.trim() || !!sending} onClick={() => void send(true)}>
                {sending === "ask" ? "送出中…" : "問 AI"}
              </button>
            </span>
          </div>
          <p className="rm-hint">
            Enter 送出（AI 不回）・Ctrl+Enter 問 AI<span className="rm-hint-shift">・Shift+Enter 換行</span>
          </p>
        </div>
      )}
    </div>
  );
}

type MenuEntry = { key: string; label: string; disabled?: boolean; bad?: boolean; run?: () => void; href?: string };

/**
 * A small popover next to a button (disclosure pattern). Opening moves focus into it; closing from
 * inside (Escape, a choice) hands focus back to the button.
 */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    const inside = !!ref.current?.contains(document.activeElement);
    setOpen(false);
    if (inside) button.current?.focus();
  }, []);
  useDismiss(ref, open, close);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>(".rm-pop button:not(:disabled), .rm-pop a")?.focus();
  }, [open]);
  return { open, setOpen, close, ref, button };
}

/** The room's own ⋯: notes, GitHub, and ending the room (last, apart from the rest). */
function RoomMenu({ items }: { items: MenuEntry[] }) {
  const { open, setOpen, close, ref, button } = usePopover();
  return (
    <div className="more-menu" ref={ref}>
      <button ref={button} type="button" className="ctl rm-more-btn" aria-label="房間選項" title="房間選項" aria-expanded={open} aria-controls="rm-menu" onClick={() => setOpen((v) => !v)}>
        <Glyph name="more" />
      </button>
      {open && (
        <div id="rm-menu" className="menu menu-right card rm-menu rm-pop">
          {items.map((it) =>
            it.href ? (
              <a key={it.key} className="menu-item" href={it.href} target="_blank" rel="noreferrer" onClick={close}>
                <span className="grow">{it.label}</span>
                <Glyph name="arrow" size={12} className="rm-ext" />
              </a>
            ) : (
              <button
                key={it.key}
                type="button"
                className={`menu-item${it.bad ? " menu-bad" : ""}`}
                disabled={it.disabled}
                onClick={() => {
                  close();
                  it.run?.();
                }}
              >
                <span className="grow">{it.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Host only: which model answers 「問 AI」 and how hard it thinks. Sits next to the button so
 * everyone knows who answers before asking; a change applies from the next question. The popover
 * stays open so model and effort can both be set in one go.
 */
function AiPicker({ chat, onChanged, onError }: { chat: Chat; onChanged: (s: ChatSummary) => void; onError: (m: string) => void }) {
  const { agents } = useAgents();
  const agent = agents?.find((a) => a.agent === chat.agent);
  const model = agent?.models.find((m) => m.id === chat.model);
  const { open, setOpen, ref, button } = usePopover();
  const [busy, setBusy] = useState(false);
  const configure = async (modelId: string, effort?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      onChanged(await api<ChatSummary>("PATCH", `/api/chats/${chat.id}`, { model: modelId, reasoningEffort: effort }));
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const efforts = model?.reasoningEfforts ?? [];
  const modelName = !chat.model ? "預設模型" : (model?.label ?? chat.model);
  const label = [AI_NAME[chat.agent], modelName, efforts.length ? (chat.reasoningEffort ?? "預設 effort") : null].filter(Boolean).join(" · ");
  const locked = chat.running || busy || !agent;
  return (
    <div className="rm-ai" ref={ref}>
      <button
        ref={button}
        type="button"
        className="ctl rm-ai-btn"
        aria-expanded={open}
        aria-controls="rm-ai-menu"
        title={chat.running ? "AI 回覆中，回完才能換" : "問 AI 時用的模型和 effort，下一次問起生效"}
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rm-ai-mark" aria-hidden="true">
          AI
        </span>
        <span className="rm-ai-text">{busy ? "切換中…" : label}</span>
        <Glyph name="chevron" size={12} />
      </button>
      {open && agent && (
        <div id="rm-ai-menu" className="menu card rm-ai-menu rm-pop">
          <p className="rm-menu-h" id="rm-ai-models">
            模型
          </p>
          <div role="group" aria-labelledby="rm-ai-models">
            {agent.models.map((m) => {
              const on = m.id === chat.model;
              return (
                <button
                  key={m.id || "default"}
                  type="button"
                  aria-pressed={on}
                  className="menu-item"
                  onClick={() => {
                    if (!on) void configure(m.id, chat.reasoningEffort && m.reasoningEfforts?.includes(chat.reasoningEffort) ? chat.reasoningEffort : undefined);
                  }}
                >
                  <span className="grow">{m.id ? m.label : "預設模型"}</span>
                  {on && <Glyph name="check" size={14} />}
                </button>
              );
            })}
          </div>
          <p className="rm-menu-h" id="rm-ai-effort">
            Effort
          </p>
          {efforts.length > 0 ? (
            <div className="rm-seg" role="group" aria-labelledby="rm-ai-effort">
              {["", ...efforts].map((e) => {
                const on = (chat.reasoningEffort ?? "") === e;
                return (
                  <button key={e || "default"} type="button" aria-pressed={on} onClick={() => !on && void configure(chat.model, e || undefined)}>
                    {e || "預設"}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rm-menu-note">這個模型不能調 effort</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Long messages show their first lines; the rest opens on request. */
function Clamp({ children, on = true }: { children: ReactNode; on?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    // Only clamp when it saves real reading: well past the clamp height, not a line or two over.
    const check = () => setLong(el.scrollHeight > 320);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [on]);
  const clamped = on && long && !open;
  return (
    <>
      <div ref={ref} className={`rm-clamp${clamped ? " is-clamped" : ""}`}>
        {children}
      </div>
      {on && long && (
        <button type="button" className="tb-link rm-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "收起" : "顯示全部"}
        </button>
      )}
    </>
  );
}

function Said({ by, me, text, at, now, ask, clamp }: { by: string; me: string; text: string; at: string; now: number; ask: boolean; clamp: boolean }) {
  const mine = by.toLowerCase() === me.toLowerCase();
  const d = splitDrafter(text);
  return (
    <div className="rm-msg">
      <div className="rm-who">
        <Avatar login={by} size={16} />
        <span className="rm-name">{mine ? "你" : `@${by}`}</span>
        {d.drafter && <span className="rm-drafter">{d.drafter} 寫的</span>}
        <span className="rm-time">{relTime(at, now)}</span>
        {ask && <span className="rm-ask">問 AI</span>}
      </div>
      <div className="rm-text">
        <Clamp on={clamp}>
          <MarkdownLite text={d.text} />
        </Clamp>
      </div>
    </div>
  );
}

function Message({ m, me, now, clamp }: { m: RoomMessage; me: string; now: number; clamp: boolean }) {
  if (!m.ai) return <Said by={m.by} me={me} text={m.text} at={m.at} now={now} ask={!!m.ask} clamp={clamp} />;
  return <AiSaid name={m.label?.split(" · ")[0] || "AI"} detail={m.label} text={m.text} at={m.at} now={now} clamp={clamp} />;
}

function AiSaid({ name, detail, text, at, now, streaming, clamp }: { name: string; detail?: string; text: string; at: string; now: number; streaming?: boolean; clamp: boolean }) {
  return (
    <div className="rm-msg is-ai">
      <div className="rm-who" title={detail}>
        <span className="rm-ai-mark" aria-hidden="true">
          AI
        </span>
        <span className="rm-name">{name}</span>
        <span className="rm-time">{relTime(at, now)}</span>
      </div>
      <div className="rm-text">
        <Clamp on={clamp && !streaming}>
          <MarkdownLite text={text} />
          {streaming && <span className="caret" aria-hidden="true" />}
        </Clamp>
      </div>
    </div>
  );
}
