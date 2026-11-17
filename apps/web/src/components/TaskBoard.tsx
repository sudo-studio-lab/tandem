import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type { BoardMember, ProjectBoard, WaitingItem } from "@tandem/contracts";
import { api, projectPath } from "../api.ts";
import { Ext } from "./Ext.tsx";
import { Avatar, errMsg } from "./ui.tsx";
import { PersonCard } from "./People.tsx";
import { relTime, waitedFor } from "../time.ts";
import "./collaboration.css";

/*
 * The board as one narrow column (fits an editor's side panel), laid out
 * like a task board: all / mine on the left, teammates' faces on the right,
 * then what waits on me (only when something does) and PRs and tasks grouped
 * by state. Clicking a face filters the list to that person and opens their
 * full status.
 */

type GroupKey = "ready" | "working" | "done";

interface Item {
  key: string;
  number: number;
  title: string;
  url: string;
  kind: "pr" | "task";
  owners: string[];
  group: GroupKey;
  blocked: boolean;
  draft: boolean;
  time: string;
  prs?: { number:number;url:string }[];
}

const GROUPS: { key: GroupKey; label: string; open: boolean }[] = [
  { key: "ready", label: "已開 PR", open: true },
  { key: "working", label: "進行中", open: true },
  { key: "done", label: "最近完成", open: false },
];

const WAIT_KIND: Record<WaitingItem["kind"], string> = {
  discussion: "請你回答",
  pr_review: "請你看",
  blocked_issue: "等你完成",
};

function Icon({ name, className }: { name: "wait" | "ready" | "working" | "done" | "pr" | "task"; className?: string }) {
  const common = { className: `tb-ic${className ? ` ${className}` : ""}`, viewBox: "0 0 16 16", "aria-hidden": true } as const;
  switch (name) {
    case "wait":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.8V8l2.2 1.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "ready":
      return (
        <svg {...common}>
          <circle cx="4.5" cy="3.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="4.5" cy="12.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="11.5" cy="8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M4.5 5.1v5.8M4.5 5.5c0 2 2 2.5 5.4 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "working":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.2" />
        </svg>
      );
    case "done":
      return (
        <svg {...common}>
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "pr":
      return (
        <svg {...common}>
          <circle cx="4.5" cy="3.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="4.5" cy="12.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="11.5" cy="12.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4.5 5.1v5.8M11.5 10.9V7c0-1.5-1-2.5-2.5-2.5H7" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case "task":
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.5 8h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
  }
}

function collect(board: ProjectBoard): Item[] {
  const items: Item[] = [];
  for (const p of board.pullRequests) {
    if (p.state === "closed") continue;
    if(p.closes?.some(n=>board.tasks.some(t=>t.number===n))) continue;
    items.push({
      key: `pr${p.number}`,
      number: p.number,
      title: p.title,
      url: p.url,
      kind: "pr",
      owners: [p.author],
      group: p.state === "merged" ? "done" : p.draft ? "working" : "ready",
      blocked: false,
      draft: p.draft,
      time: p.mergedAt ?? p.updatedAt,
    });
  }
  for (const t of board.tasks) {
    const linked=board.pullRequests.filter(p=>p.closes?.includes(t.number));
    items.push({
      key: `task${t.number}`,
      number: t.number,
      title: t.title,
      url: t.url,
      kind: "task",
      owners: t.assignees.length ? t.assignees : [t.author],
      group: t.state === "closed" ? "done" : linked.some(p=>p.state==="open"&&!p.draft)?"ready":"working",
      blocked: t.state === "open" && t.blockedBy.length > 0,
      draft: false,
      time: t.closedAt ?? t.updatedAt,
      prs:linked.map(p=>({number:p.number,url:p.url})),
    });
  }
  return items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

function Row({ it, now }: { it: Item; now: number }) {
  return (
    <li className="tb-row">
      <div className="tb-item-top"><Icon name={it.group} className={`tb-${it.group}`} /><span className="tb-num">#{it.number}</span><Ext href={it.url} className="tb-title">{it.title}</Ext></div>
      <div className="tb-item-meta"><span title={relTime(it.time,now)}>{it.kind==="pr"?(it.draft?"草稿 PR":"PR"):"任務"}</span>{it.blocked&&<span className="tag tag-bad">被卡住</span>}<span>負責 {it.owners.map(o=>`@${o}`).join("、")}</span>{it.prs?.map(p=><Ext key={p.number} href={p.url}>PR #{p.number}</Ext>)}</div>
    </li>
  );
}

function Group({ label, k, open, items, now, empty }: { label: string; k: GroupKey; open: boolean; items: Item[]; now: number; empty: ReactNode }) {
  return (
    <details className="tb-group" open={open}>
      <summary>
        <span className="tb-chev" aria-hidden="true" />
        <Icon name={k} className={`tb-${k}`} />
        <span className="tb-group-label">{label}</span>
        <span className="tb-count">{items.length}</span>
      </summary>
      {items.length === 0 ? (
        <p className="tb-empty">{empty}</p>
      ) : (
        <ul className="tb-rows">
          {items.map((it) => (
            <Row key={it.key} it={it} now={now} />
          ))}
        </ul>
      )}
    </details>
  );
}

function Face({ m, me, now, selected, onPick }: { m: BoardMember; me: string; now: number; selected: boolean; onPick: () => void }) {
  const s = m.status;
  const fresh = s && now - Date.parse(s.updated) < 24 * 3600_000;
  const line = s?.blocked ? `卡在：${s.blocked}` : s?.doing || "還沒寫狀態";
  const label = `${m.login}${m.login === me ? "（你）" : ""}：${line}${s ? `（${relTime(s.updated, now)}更新）` : ""}`;
  return (
    <button type="button" className={`tb-face${selected ? " is-sel" : ""}`} aria-pressed={selected} aria-label={label} title={label} onClick={onPick}>
      <Avatar login={m.login} size={28} />
      <i className={`tb-dot${s?.blocked ? " is-blocked" : fresh ? " is-fresh" : ""}`} aria-hidden="true" />
    </button>
  );
}

function WaitGroup({ items, now }: { items: WaitingItem[]; now: number }) {
  return (
    <details className="tb-group tb-group-wait" open>
      <summary>
        <span className="tb-chev" aria-hidden="true" />
        <Icon name="wait" className="tb-wait-ic" />
        <span className="tb-group-label">等你</span>
        <span className="tb-count">{items.length}</span>
      </summary>
      <ul className="tb-rows">
        {items.map((w, i) => (
          <li key={i} className="tb-row">
            <Icon name="wait" className="tb-wait-ic" />
            <span className="tb-kind">{WAIT_KIND[w.kind]}</span>
            <Ext href={w.url} className="tb-title">
              {w.title}
            </Ext>
            <span className="tb-meta">
              @{w.from}・{waitedFor(w.since, now)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Inline form under the bar: a person (not an agent) opens a task. Enter in the title submits, Esc cancels. */
function NewTask({ board, members, onDone, onCancel }: { board: ProjectBoard; members: BoardMember[]; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [assign, setAssign] = useState<string[]>([board.me]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (login: string) => setAssign((a) => (a.includes(login) ? a.filter((x) => x !== login) : [...a, login]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api<{ number: number; url: string }>("POST", projectPath(board.projectId, "/tasks"), {
        title: title.trim(),
        body: body.trim() || undefined,
        assign,
      });
      onDone();
    } catch (e2) {
      setErr(errMsg(e2));
      setBusy(false);
    }
  }

  return (
    <form
      className="tb-new"
      aria-label="新任務"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <label htmlFor="tb-new-title" className="sr-only">
        標題
      </label>
      <input
        id="tb-new-title"
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="標題"
        maxLength={256}
        autoComplete="off"
        autoFocus
        required
        disabled={busy}
      />
      <label htmlFor="tb-new-body" className="sr-only">
        說明
      </label>
      <textarea id="tb-new-body" className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="說明（選填）" disabled={busy} />
      <div className="tb-new-assign" role="group" aria-labelledby="tb-new-assign-label">
        <span id="tb-new-assign-label" className="tb-new-label">
          指派給
        </span>
        {members.map((m) => {
          const on = assign.includes(m.login);
          const name = `@${m.login}${m.login === board.me ? "（你）" : ""}`;
          return (
            <button
              key={m.login}
              type="button"
              className={`btn btn-small co-assign${on ? " is-sel" : ""}`}
              aria-pressed={on}
              aria-label={name}
              title={name}
              disabled={busy}
              onClick={() => toggle(m.login)}
            >
              <Avatar login={m.login} size={22} /><span>@{m.login}</span>
            </button>
          );
        })}
      </div>
      {err && (
        <p className="field-error" role="alert">
          {err}
        </p>
      )}
      <div className="tb-new-actions">
        <button type="button" className="btn btn-small btn-quiet" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" className="btn btn-small btn-primary" disabled={busy || !title.trim()}>
          {busy ? "建立中…" : "建立"}
        </button>
      </div>
    </form>
  );
}

export function TaskBoard({ board, now, onTaskCreated }: { board: ProjectBoard; now: number; onTaskCreated?: () => void | Promise<void> }) {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [person, setPerson] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addButton=useRef<HTMLButtonElement>(null);
  const closeNew=()=>{setAdding(false);requestAnimationFrame(()=>addButton.current?.focus());};
  const [layout,setLayout]=useState<"list"|"board">(()=>{try{return localStorage.getItem(`tandem-layout:${board.projectId}`)==="board"?"board":"list";}catch{return "list";}});
  const changeLayout=(next:"list"|"board")=>{setLayout(next);try{localStorage.setItem(`tandem-layout:${board.projectId}`,next);}catch{/* session-only when storage is unavailable */}};
  const members = [...board.members].sort((a, b) => Number(b.login === board.me) - Number(a.login === board.me));
  const mine = board.waiting
    .filter((w) => w.to === board.me && (!person || person === board.me || w.from === person))
    .sort((a, b) => Date.parse(a.since) - Date.parse(b.since));

  const who = person ?? (scope === "mine" ? board.me : null);
  const items = collect(board).filter((it) => !who || it.owners.includes(who));
  const picked = person ? members.find((m) => m.login === person) : undefined;

  return (
    <div className={`tb tb-layout-${layout}`}>
      <div className="tb-bar">
        {person ? (
          <p className="tb-filter-note">
            只看 @{person}・
            <button type="button" className="tb-link" onClick={() => setPerson(null)}>
              看全部
            </button>
          </p>
        ) : (
          <div className="tb-pills" role="group" aria-label="範圍">
            <button type="button" className={scope === "all" ? "is-on" : undefined} aria-pressed={scope === "all"} onClick={() => setScope("all")}>
              所有任務
            </button>
            <button type="button" className={scope === "mine" ? "is-on" : undefined} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>
              我負責
            </button>
          </div>
        )}
        <button ref={addButton} type="button" className="tb-new-btn" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
          新增任務
        </button>
        <label className="tb-member-filter"><span className="sr-only">依成員篩選</span><select className="input" value={person??""} onChange={e=>setPerson(e.target.value||null)}><option value="">所有成員</option>{members.map(m=><option key={m.login} value={m.login}>@{m.login}</option>)}</select></label>
        <div className="tb-layout-switch" role="group" aria-label="任務檢視"><button type="button" className="btn btn-small" aria-pressed={layout==="list"} onClick={()=>changeLayout("list")}>清單</button><button type="button" className="btn btn-small" aria-pressed={layout==="board"} onClick={()=>changeLayout("board")}>看板</button></div>
      </div>

      {adding && (
        <NewTask
          board={board}
          members={members}
          onCancel={closeNew}
          onDone={() => {
            closeNew();
            void onTaskCreated?.();
          }}
        />
      )}

      {picked && (
        <div className="tb-picked">
          <PersonCard m={picked} board={board} now={now} />
        </div>
      )}

      {mine.length > 0 && <WaitGroup items={mine} now={now} />}

      <div className="tb-groups">{GROUPS.map((g) => (
        <Group
          key={g.key}
          k={g.key}
          label={g.label}
          open={g.open}
          now={now}
          items={items.filter((it) => it.group === g.key)}
          empty={g.key === "ready" ? "沒有開著的 PR" : g.key === "working" ? "沒有進行中的草稿 PR 或任務" : "最近兩週沒有完成的項目"}
        />
      ))}</div>
    </div>
  );
}
