import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AgentKind,
  AgentLoginStart,
  AgentStatus,
  ApprovalDecision,
  Chat,
  ChatItem,
  ChatSummary,
  ChatUpdate,
} from "@tandem/contracts";
import { api, onAppEvent, projectPath } from "../api.ts";
import { relTime } from "../time.ts";
import { Modal, Spinner, errMsg } from "./ui.tsx";

const AUTH_TEXT: Record<AgentStatus["auth"], string> = {
  subscription: "已用訂閱登入",
  apiKey: "已用 API key 登入",
  none: "未登入",
  unknown: "登入狀態不明",
};

export const usableAgents = (agents: AgentStatus[]) => agents.filter((a) => a.installed && (a.auth === "subscription" || a.auth === "apiKey"));

/** Agent install / login state, shared by the chat view and the settings dialog. */
export function useAgents() {
  const [agents, setAgents] = useState<AgentStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    try {
      setAgents(await api<AgentStatus[]>("GET", `/api/agents${refresh ? "?refresh=1" : ""}`));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    void load();
    return onAppEvent((e) => {
      if (e.type === "agents") setAgents(e.data);
    });
  }, [load]);
  return { agents, error, reload: load };
}

// ---------------------------------------------------------------------------
// AI settings: login / logout per agent (spec 003 情境 2)
// ---------------------------------------------------------------------------
export function AgentSettingsDialog({ onClose }: { onClose: () => void }) {
  const { agents, error, reload } = useAgents();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  // After starting a login elsewhere (terminal / browser), check again every few seconds for a while.
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      void reload(true);
      if (n > 40) setWaiting(false);
    }, 5000);
    return () => clearInterval(t);
  }, [waiting, reload]);

  const login = async (a: AgentKind, method: "subscription" | "apiKey") => {
    setBusy(`${a}:${method}`);
    try {
      const r = await api<AgentLoginStart>("POST", `/api/agents/${a}/login`, { method });
      setNote(r.message);
      setWaiting(true);
    } catch (e) {
      setNote(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const logout = async (a: AgentKind) => {
    setBusy(`${a}:logout`);
    try {
      await api("POST", `/api/agents/${a}/logout`);
      await reload(true);
    } catch (e) {
      setNote(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="AI 設定" onClose={onClose}>
      <p className="muted small">登入一律走各家自己的流程，Tandem 不會看到也不會保存你的帳號或 API key。</p>
      {error && <p className="banner banner-error">{error}</p>}
      {!agents ? (
        <Spinner label="檢查中…" />
      ) : (
        <ul className="agent-list">
          {agents.map((a) => (
            <li key={a.agent} className="agent-row">
              <div>
                <strong>{a.label}</strong>
                {a.version && <span className="muted small"> {a.version}</span>}
                <div className="small">
                  {!a.installed ? (
                    <span className="muted">這台電腦還沒安裝</span>
                  ) : (
                    <span className={`pill ${a.auth === "none" ? "pill-warn" : a.auth === "unknown" ? "pill-bad" : "pill-ok"}`}>
                      {AUTH_TEXT[a.auth]}
                      {a.plan ? `（${a.plan}）` : ""}
                    </span>
                  )}
                  {a.note && <span className="muted"> {a.note}</span>}
                </div>
              </div>
              <div className="agent-actions">
                {!a.installed ? (
                  <a className="btn btn-small" href={a.installUrl} target="_blank" rel="noreferrer">
                    安裝說明
                  </a>
                ) : a.auth === "subscription" || a.auth === "apiKey" ? (
                  <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void logout(a.agent)}>
                    登出
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-small btn-primary" disabled={!!busy} onClick={() => void login(a.agent, "subscription")}>
                      用{a.agent === "claude" ? " Claude " : " ChatGPT "}帳號登入
                    </button>
                    <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void login(a.agent, "apiKey")}>
                      用 API key
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="banner">{note}</p>}
      <div className="row-end">
        <button type="button" className="btn btn-small" onClick={() => void reload(true)}>
          {waiting ? "等你登入中…（重新檢查）" : "重新檢查"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Chat view
// ---------------------------------------------------------------------------
export function ChatView({ projectId, now, onOpenSettings }: { projectId: string; now: number; onOpenSettings: () => void }) {
  const { agents } = useAgents();
  const [list, setList] = useState<ChatSummary[] | null>(null);
  const [current, setCurrent] = useState<Chat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const currentId = useRef<string | null>(null);
  currentId.current = current?.id ?? null;

  const loadList = useCallback(async () => {
    try {
      setList(await api<ChatSummary[]>("GET", projectPath(projectId, "/chats")));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [projectId]);

  const open = useCallback(async (id: string) => {
    try {
      setCurrent(await api<Chat>("GET", `/api/chats/${id}`));
      setCreating(false);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    setCurrent(null);
    setList(null);
    void loadList();
  }, [loadList]);

  // Live updates.
  useEffect(
    () =>
      onAppEvent((e) => {
        if (e.type !== "chat") return;
        const u: ChatUpdate = e.data;
        if (u.type === "summary") {
          if (u.chat.projectId !== projectId) return;
          setList((l) => {
            const rest = (l ?? []).filter((c) => c.id !== u.chat.id);
            return [u.chat, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          });
        }
        if (u.type === "deleted") setList((l) => (l ?? []).filter((c) => c.id !== u.chatId));
        if (u.chatId !== currentId.current) return;
        setCurrent((c) => (c ? applyUpdate(c, u) : c));
      }),
    [projectId],
  );

  const usable = agents ? usableAgents(agents) : [];
  const showNew = creating || (!current && list !== null && list.length === 0);

  return (
    <main className="chat-page">
      <aside className="chat-list" aria-label="對話清單">
        <button type="button" className="btn btn-primary chat-new" onClick={() => setCreating(true)}>
          ＋ 新對話
        </button>
        {list === null ? (
          <Spinner label="載入中…" />
        ) : (
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`chat-list-item${c.id === current?.id ? " is-current" : ""}`}
                  onClick={() => void open(c.id)}
                >
                  <span className="chat-list-title">{c.title}</span>
                  <span className="muted small">
                    {agentLabel(agents, c.agent)}
                    {c.model ? ` · ${c.model}` : ""} · {c.running ? "回覆中…" : relTime(c.updatedAt, now)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-small btn-quiet" onClick={onOpenSettings}>
          ⚙ AI 設定（登入、登出）
        </button>
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
          <NewChat
            agents={agents}
            usable={usable}
            onOpenSettings={onOpenSettings}
            onCancel={current || (list?.length ?? 0) > 0 ? () => setCreating(false) : undefined}
            onCreate={async (agent, model) => {
              const c = await api<ChatSummary>("POST", projectPath(projectId, "/chats"), { agent, model });
              await open(c.id);
            }}
          />
        ) : current ? (
          <Conversation chat={current} agents={agents} onError={setError} onDeleted={() => setCurrent(null)} />
        ) : (
          <p className="muted chat-empty">從左邊選一段對話，或開始新對話。</p>
        )}
      </section>
    </main>
  );
}

function agentLabel(agents: AgentStatus[] | null, kind: AgentKind) {
  return agents?.find((a) => a.agent === kind)?.label ?? (kind === "claude" ? "Claude" : "Codex");
}

export function applyUpdate(c: Chat, u: ChatUpdate): Chat {
  switch (u.type) {
    case "summary":
      return { ...c, ...u.chat, items: c.items };
    case "item": {
      const i = c.items.findIndex((x) => x.id === u.item.id);
      const items = c.items.slice();
      if (i >= 0) items[i] = u.item;
      else items.push(u.item);
      return { ...c, items };
    }
    case "delta":
      return {
        ...c,
        items: c.items.map((x) => (x.id === u.itemId && x.kind === "assistant" ? { ...x, text: x.text + u.text } : x)),
      };
    default:
      return c;
  }
}

function NewChat(props: {
  agents: AgentStatus[] | null;
  usable: AgentStatus[];
  onOpenSettings: () => void;
  onCancel?: () => void;
  onCreate: (agent: AgentKind, model: string) => Promise<void>;
}) {
  const { agents, usable } = props;
  const [choice, setChoice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(
    () => usable.flatMap((a) => a.models.map((m) => ({ key: `${a.agent}|${m.id}`, label: `${a.label} · ${m.label}`, agent: a.agent, model: m.id }))),
    [usable],
  );
  useEffect(() => {
    if (!options.some((o) => o.key === choice)) setChoice(options[0]?.key ?? "");
  }, [options, choice]);

  if (!agents) return <Spinner label="檢查你登入了哪些 AI…" />;
  if (usable.length === 0) {
    return (
      <div className="card pad chat-setup">
        <h2>還沒有可用的 AI</h2>
        <p className="muted">
          用你自己的 Claude 或 Codex（訂閱或 API key 都可以）。登入走它們自己的流程，Tandem 不會看到你的帳號。
        </p>
        <button type="button" className="btn btn-primary" onClick={props.onOpenSettings}>
          登入 AI
        </button>
      </div>
    );
  }
  const create = async () => {
    const o = options.find((x) => x.key === choice);
    if (!o) return;
    setBusy(true);
    setError(null);
    try {
      await props.onCreate(o.agent, o.model);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <div className="card pad chat-setup">
      <h2>新對話</h2>
      <label className="chat-field">
        <span>用哪一個 AI</span>
        <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        只列出你已經登入的。{" "}
        <button type="button" className="btn-link" onClick={props.onOpenSettings}>
          登入其他家
        </button>
      </p>
      {error && <p className="banner banner-error">{error}</p>}
      <div className="row-end">
        {props.onCancel && (
          <button type="button" className="btn" onClick={props.onCancel}>
            取消
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={!choice || busy} onClick={() => void create()}>
          開始
        </button>
      </div>
    </div>
  );
}

function Conversation({
  chat,
  agents,
  onError,
  onDeleted,
}: {
  chat: Chat;
  agents: AgentStatus[] | null;
  onError: (m: string) => void;
  onDeleted: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const model = agents?.find((a) => a.agent === chat.agent)?.models.find((m) => m.id === chat.model)?.label ?? chat.model;

  // Follow new output unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.items]);

  const send = async () => {
    const body = text.trim();
    if (!body || chat.running) return;
    setSending(true);
    try {
      await api("POST", `/api/chats/${chat.id}/messages`, { text: body });
      setText("");
      stick.current = true;
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setSending(false);
    }
  };
  const stop = () => api("POST", `/api/chats/${chat.id}/interrupt`).catch((e) => onError(errMsg(e)));
  const remove = async () => {
    if (!confirm("刪除這段對話在這台電腦上的紀錄？（已經記進 Tandem 的決定和狀態不受影響）")) return;
    try {
      await api("DELETE", `/api/chats/${chat.id}`);
      onDeleted();
    } catch (e) {
      onError(errMsg(e));
    }
  };

  return (
    <div className="chat">
      <div className="chat-head">
        <div>
          <strong>{chat.title}</strong>
          <span className="muted small">
            {" "}
            {agentLabel(agents, chat.agent)} · {model || "預設"}
            {chat.costUsd ? ` · 約 US$${chat.costUsd.toFixed(2)}` : ""}
          </span>
        </div>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => void remove()}>
          刪除
        </button>
      </div>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {chat.items.length === 0 && (
          <p className="muted chat-empty">
            跟 {agentLabel(agents, chat.agent)} 說要做什麼。它已經知道團隊最近的決定和進度，也能幫你記決定、更新狀態。
          </p>
        )}
        {chat.items.map((it) => (
          <Item key={it.id} item={it} chatId={chat.id} onError={onError} />
        ))}
        {chat.running && !chat.items.some((x) => x.kind === "approval" && x.state === "pending") && (
          <p className="muted small chat-working">
            <span className="spin" aria-hidden="true" /> 工作中…
          </p>
        )}
      </div>
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          rows={3}
          placeholder={chat.running ? "等它回覆完，或按停止" : "輸入訊息（Enter 送出，Shift+Enter 換行）"}
          aria-label="訊息"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {chat.running ? (
          <button type="button" className="btn btn-danger" onClick={() => void stop()}>
            停止
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!text.trim() || sending}>
            送出
          </button>
        )}
      </form>
    </div>
  );
}

const prettyTool = (name: string) => (name.startsWith("mcp__") ? name.split("__").slice(1).join(" · ") : name);

export function Item({ item, chatId, onError }: { item: ChatItem; chatId: string; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  switch (item.kind) {
    case "user":
      return <div className="msg msg-user">{item.text}</div>;
    case "assistant":
      return (
        <div className="msg msg-assistant">
          {item.text}
          {item.streaming && <span className="caret" aria-hidden="true" />}
        </div>
      );
    case "notice":
      return <p className="msg-notice muted small">{item.text}</p>;
    case "error":
      return (
        <div className="banner banner-error msg-error" role="alert">
          {item.message}
          {item.detail && (
            <details>
              <summary className="small">原始訊息</summary>
              <pre>{item.detail}</pre>
            </details>
          )}
        </div>
      );
    case "tool":
      return (
        <details className={`tool tool-${item.status}`}>
          <summary>
            <span className="tool-status" aria-label={item.status === "running" ? "執行中" : item.status === "done" ? "完成" : "失敗"}>
              {item.status === "running" ? "…" : item.status === "done" ? "✓" : "✕"}
            </span>{" "}
            <strong>{prettyTool(item.name)}</strong> <span className="muted">{item.summary}</span>
          </summary>
          {item.input !== undefined && <pre>{JSON.stringify(item.input, null, 2)}</pre>}
          {item.output && <pre>{item.output}</pre>}
        </details>
      );
    case "approval": {
      const decide = async (decision: ApprovalDecision) => {
        setBusy(true);
        try {
          await api("POST", `/api/chats/${chatId}/approvals/${item.id}`, { decision });
        } catch (e) {
          onError(errMsg(e));
          setBusy(false);
        }
      };
      return (
        <div className={`approval approval-${item.state}`}>
          <div className="approval-head">
            <span aria-hidden="true">{item.state === "pending" ? "✋" : item.state === "allowed" ? "✓" : "✕"}</span>
            <strong>{item.state === "pending" ? "AI 想做這件事，可以嗎？" : item.state === "allowed" ? "已同意" : "已拒絕"}</strong>
            <span className="tag">{prettyTool(item.name)}</span>
            {item.note && <span className="muted small">（{item.note}）</span>}
          </div>
          {item.summary && <code className="approval-summary">{item.summary}</code>}
          {item.input !== undefined && (
            <details>
              <summary className="small">詳細內容</summary>
              <pre>{JSON.stringify(item.input, null, 2)}</pre>
            </details>
          )}
          {item.state === "pending" && (
            <div className="row-end">
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => void decide("deny")}>
                拒絕
              </button>
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => void decide("allowSession")}>
                這段對話都同意
              </button>
              <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void decide("allow")}>
                同意
              </button>
            </div>
          )}
        </div>
      );
    }
  }
}
