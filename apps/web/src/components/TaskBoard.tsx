import { useState, type ReactNode } from "react";
import type { BoardMember, ProjectBoard, WaitingItem } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Avatar } from "./ui.tsx";
import { PersonCard } from "./People.tsx";
import { relTime, waitedFor } from "../time.ts";

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
    items.push({
      key: `task${t.number}`,
      number: t.number,
      title: t.title,
      url: t.url,
      kind: "task",
      owners: t.assignees.length ? t.assignees : [t.author],
      group: t.state === "closed" ? "done" : "working",
      blocked: t.state === "open" && t.blockedBy.length > 0,
      draft: false,
      time: t.closedAt ?? t.updatedAt,
    });
  }
  return items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

function Row({ it, now }: { it: Item; now: number }) {
  return (
    <li className="tb-row">
      <Icon name={it.group} className={`tb-${it.group}`} />
      <span className="tb-num">#{it.number}</span>
      <Ext href={it.url} className="tb-title">
        {it.title}
      </Ext>
      {it.blocked && <span className="tag tag-bad">被卡住</span>}
      <span className={`tb-chip${it.kind === "pr" ? ` tb-chip-${it.group}` : ""}`} title={relTime(it.time, now)}>
        <Icon name={it.kind} />
        {it.kind === "pr" ? (it.draft ? "草稿" : "PR") : "任務"}
      </span>
      <span className="tb-owners" title={it.owners.map((o) => `@${o}`).join("、")}>
        {it.owners.slice(0, 2).map((o) => (
          <Avatar key={o} login={o} size={22} />
        ))}
      </span>
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

export function TaskBoard({ board, now }: { board: ProjectBoard; now: number }) {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [person, setPerson] = useState<string | null>(null);
  const members = [...board.members].sort((a, b) => Number(b.login === board.me) - Number(a.login === board.me));
  const mine = board.waiting
    .filter((w) => w.to === board.me && (!person || person === board.me || w.from === person))
    .sort((a, b) => Date.parse(a.since) - Date.parse(b.since));

  const who = person ?? (scope === "mine" ? board.me : null);
  const items = collect(board).filter((it) => !who || it.owners.includes(who));
  const picked = person ? members.find((m) => m.login === person) : undefined;

  return (
    <div className="tb">
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
              全部
            </button>
            <button type="button" className={scope === "mine" ? "is-on" : undefined} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>
              我的
            </button>
          </div>
        )}
        <div className="tb-faces" role="group" aria-label="成員（點一下只看這個人）">
          {members.map((m) => (
            <Face key={m.login} m={m} me={board.me} now={now} selected={person === m.login} onPick={() => setPerson(person === m.login ? null : m.login)} />
          ))}
        </div>
      </div>

      {picked && (
        <div className="tb-picked">
          <PersonCard m={picked} board={board} now={now} />
        </div>
      )}

      {mine.length > 0 && <WaitGroup items={mine} now={now} />}

      {GROUPS.map((g) => (
        <Group
          key={g.key}
          k={g.key}
          label={g.label}
          open={g.open}
          now={now}
          items={items.filter((it) => it.group === g.key)}
          empty={g.key === "ready" ? "沒有開著的 PR" : g.key === "working" ? "沒有進行中的草稿 PR 或任務" : "最近兩週沒有完成的項目"}
        />
      ))}
    </div>
  );
}
