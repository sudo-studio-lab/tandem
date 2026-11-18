import { useState } from "react";
import type { BoardMember, ProjectBoard, WaitingItem } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Avatar } from "./ui.tsx";
import { Glyph } from "./icons.tsx";
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
  // Stuck items first in every group, then newest first.
  return items.sort((a, b) => Number(b.blocked) - Number(a.blocked) || Date.parse(b.time) - Date.parse(a.time));
}

function Row({ it, now }: { it: Item; now: number }) {
  const kind = it.kind === "pr" ? (it.draft ? "草稿 PR" : "PR") : "任務";
  const owners = it.owners.map((o) => `@${o}`).join("、");
  const detail = `${kind}・負責 ${owners}・${relTime(it.time, now)}更新`;
  return (
    <li className="tb-row" title={`#${it.number} ${it.title}
${detail}`}>
      <span className="tb-num">#{it.number}</span>
      <Ext href={it.url} className="tb-title">
        {it.title}
        <span className="sr-only">（{detail}）</span>
      </Ext>
      <span className="tb-meta">
        {it.blocked && <span className="tb-stuck">卡住</span>}
        {it.draft && <span>草稿</span>}
        {it.prs?.map((p) => (
          <Ext key={p.number} href={p.url}>
            PR #{p.number}
          </Ext>
        ))}
        <span className="tb-owners">
          {it.owners.slice(0, 3).map((o) => (
            <Avatar key={o} login={o} size={16} />
          ))}
        </span>
      </span>
    </li>
  );
}

function Group({ label, k, open, items, now }: { label: string; k: GroupKey; open: boolean; items: Item[]; now: number }) {
  if (items.length === 0) {
    // Nothing here: one quiet line, nothing to expand.
    return (
      <div className="tb-group tb-group-empty">
        <div className="tb-sum">
          <span className="tb-chev-space" aria-hidden="true" />
          <Icon name={k} className={`tb-${k}`} />
          <span className="tb-group-label">{label}</span>
          <span className="tb-count">0</span>
        </div>
      </div>
    );
  }
  const stuck = items.filter((it) => it.blocked).length;
  return (
    <details className={`tb-group${k === "done" ? " tb-done-group" : ""}`} open={open}>
      <summary className="tb-sum">
        <Glyph name="chevron" size={12} className="tb-chev" />
        <Icon name={k} className={`tb-${k}`} />
        <span className="tb-group-label">{label}</span>
        <span className="tb-count">
          {stuck > 0 && <span className="tb-count-stuck">{stuck} 卡住・</span>}
          {items.length}
        </span>
      </summary>
      <ul className="tb-rows">
        {items.map((it) => (
          <Row key={it.key} it={it} now={now} />
        ))}
      </ul>
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
      <Avatar login={m.login} size={22} />
      <i className={`tb-dot${s?.blocked ? " is-blocked" : fresh ? " is-fresh" : ""}`} aria-hidden="true" />
    </button>
  );
}

/** "#15 標題" (or a URL ending in /15) → number and title, so waiting rows read like the other rows. */
function splitNumber(title: string, url: string): { num: string | null; title: string } {
  const m = title.match(/^#(\d+)\s+(.+)$/);
  if (m) return { num: m[1]!, title: m[2]! };
  return { num: url.match(/\/(\d+)\/?$/)?.[1] ?? null, title };
}

function WaitGroup({ items, now }: { items: WaitingItem[]; now: number }) {
  return (
    <details className="tb-group tb-group-wait" open>
      <summary className="tb-sum">
        <Glyph name="chevron" size={12} className="tb-chev" />
        <Icon name="wait" className="tb-wait-ic" />
        <span className="tb-group-label">等你</span>
        <span className="tb-count tb-count-strong">{items.length}</span>
      </summary>
      <ul className="tb-rows">
        {items.map((w, i) => {
          const { num, title } = splitNumber(w.title, w.url);
          return (
          <li key={i} className="tb-row" title={`${w.title}
${WAIT_KIND[w.kind]}・@${w.from}・${waitedFor(w.since, now)}`}>
            {num && <span className="tb-num">#{num}</span>}
            <Ext href={w.url} className="tb-title">
              {title}
            </Ext>
            <span className="tb-meta">
              <span className="tb-kind">{WAIT_KIND[w.kind]}</span>
              <span>
                <span className="tb-from">@{w.from}・</span>
                {waitedFor(w.since, now).replace(/^等了 /, "")}
              </span>
            </span>
          </li>
          );
        })}
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
          <div className="seg" role="group" aria-label="範圍">
            <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
              全部
            </button>
            <button type="button" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>
              我負責
            </button>
          </div>
        )}
        {members.length > 1 && (
          <div className="tb-faces" role="group" aria-label="依成員篩選">
            {members.map((m) => (
              <Face key={m.login} m={m} me={board.me} now={now} selected={person === m.login} onPick={() => setPerson((p) => (p === m.login ? null : m.login))} />
            ))}
          </div>
        )}
      </div>

      {mine.length > 0 && <WaitGroup items={mine} now={now} />}

      {picked && (
        <div className="tb-picked">
          <PersonCard m={picked} board={board} now={now} />
        </div>
      )}

      {items.length === 0 && mine.length === 0 && (
        <p className="tb-empty-note">{who ? `@${who} 目前沒有負責的任務。` : "還沒有任務。跟你的 AI 說要開什麼任務，或直接在 GitHub 開 issue。"}</p>
      )}

      {GROUPS.map((g) => (
        <Group key={g.key} k={g.key} label={g.label} open={g.open} now={now} items={items.filter((it) => it.group === g.key)} />
      ))}
    </div>
  );
}
