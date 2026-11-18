import type { ProjectBoard, WaitingItem } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Avatar } from "./ui.tsx";
import { Glyph } from "./icons.tsx";
import { relTime, waitedFor } from "../time.ts";

/*
 * The 任務 tab: one narrow column (fits an editor's side panel). What waits on
 * you (only when something does), then what you own, then what your teammates
 * own, then what finished lately. Each row says its state on the right. The
 * 隊友 tab lists the same items per person with the same rows (collect + Row).
 */

/** Where an item stands: a PR is open for review, work is under way, or it is finished. */
type State = "ready" | "working" | "done";

export interface Item {
  key: string;
  number: number;
  title: string;
  url: string;
  kind: "pr" | "task";
  owners: string[];
  state: State;
  blocked: boolean;
  draft: boolean;
  time: string;
  prs?: { number: number; url: string }[];
}

const WAIT_KIND: Record<WaitingItem["kind"], string> = {
  discussion: "請你回答",
  pr_review: "請你看",
  blocked_issue: "等你完成",
};

type IconName = "wait" | "working" | "done" | "task";

function Icon({ name, className }: { name: IconName; className?: string }) {
  const common = { className: `tb-ic${className ? ` ${className}` : ""}`, viewBox: "0 0 16 16", "aria-hidden": true } as const;
  switch (name) {
    case "wait":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.8V8l2.2 1.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
    case "task":
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.5 8h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
  }
}

export function collect(board: ProjectBoard): Item[] {
  const items: Item[] = [];
  for (const p of board.pullRequests) {
    if (p.state === "closed") continue;
    // A PR that closes a task on the board shows on that task's row instead.
    if (p.closes?.some((n) => board.tasks.some((t) => t.number === n))) continue;
    items.push({
      key: `pr${p.number}`,
      number: p.number,
      title: p.title,
      url: p.url,
      kind: "pr",
      owners: [p.author],
      state: p.state === "merged" ? "done" : p.draft ? "working" : "ready",
      blocked: false,
      draft: p.draft,
      time: p.mergedAt ?? p.updatedAt,
    });
  }
  for (const t of board.tasks) {
    const linked = board.pullRequests.filter((p) => p.closes?.includes(t.number));
    items.push({
      key: `task${t.number}`,
      number: t.number,
      title: t.title,
      url: t.url,
      kind: "task",
      owners: t.assignees.length ? t.assignees : [t.author],
      state: t.state === "closed" ? "done" : linked.some((p) => p.state === "open" && !p.draft) ? "ready" : "working",
      blocked: t.state === "open" && t.blockedBy.length > 0,
      draft: false,
      time: t.closedAt ?? t.updatedAt,
      prs: linked.map((p) => ({ number: p.number, url: p.url })),
    });
  }
  // Stuck items first, then PRs ready for review, then work under way; newest first within each.
  const rank: Record<State, number> = { ready: 0, working: 1, done: 2 };
  return items.sort((a, b) => Number(b.blocked) - Number(a.blocked) || rank[a.state] - rank[b.state] || Date.parse(b.time) - Date.parse(a.time));
}

/** The same state in plain words, for the hover text and screen readers. */
function stateWords(it: Item): string {
  if (it.state === "done") return it.kind === "pr" ? "已合併" : "完成";
  const work = it.kind === "pr" ? (it.draft ? "草稿" : "待審查") : it.prs?.length ? it.prs.map((p) => `PR #${p.number}`).join("、") : it.blocked ? "" : "進行中";
  return [it.blocked ? "卡住" : "", work].filter(Boolean).join("・");
}

/** The right side of a row: its state in words (and, for a task, the PRs that carry it). */
function StateText({ it }: { it: Item }) {
  if (it.state === "done") return <span>{it.kind === "pr" ? "已合併" : "完成"}</span>;
  return (
    <>
      {it.blocked && <span className="tb-stuck">卡住</span>}
      {it.kind === "pr" ? (
        <span className={it.draft ? undefined : "tb-ready"}>{it.draft ? "草稿" : "待審查"}</span>
      ) : it.prs?.length ? (
        it.prs.map((p) => (
          <Ext key={p.number} href={p.url} className={it.state === "ready" ? "tb-ready" : undefined}>
            PR #{p.number}
          </Ext>
        ))
      ) : (
        !it.blocked && <span>進行中</span>
      )}
    </>
  );
}

export function Row({ it, now, owners }: { it: Item; now: number; owners: boolean }) {
  const kind = it.kind === "pr" ? "PR" : "任務";
  const detail = `${kind}・${stateWords(it)}・負責 ${it.owners.map((o) => `@${o}`).join("、")}・${relTime(it.time, now)}更新`;
  return (
    <li className="tb-row" title={`#${it.number} ${it.title}\n${detail}`}>
      <span className="tb-num">#{it.number}</span>
      <Ext href={it.url} className="tb-title">
        {it.title}
        <span className="sr-only">（{detail}）</span>
      </Ext>
      <span className="tb-meta">
        <StateText it={it} />
        {owners && (
          <span className="tb-owners">
            {it.owners.slice(0, 3).map((o) => (
              <Avatar key={o} login={o} size={16} />
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

function Group(props: { label: string; icon: IconName; open: boolean; items: Item[]; now: number; owners: boolean; done?: boolean }) {
  const { label, icon, open, items, now, owners, done } = props;
  if (items.length === 0) {
    // Nothing here: one quiet line, nothing to expand.
    return (
      <div className="tb-group tb-group-empty">
        <div className="tb-sum">
          <span className="tb-chev-space" aria-hidden="true" />
          <Icon name={icon} />
          <span className="tb-group-label">{label}</span>
          <span className="tb-count">0</span>
        </div>
      </div>
    );
  }
  const stuck = items.filter((it) => it.blocked).length;
  return (
    <details className={`tb-group${done ? " tb-done-group" : ""}`} open={open}>
      <summary className="tb-sum">
        <Glyph name="chevron" size={12} className="tb-chev" />
        <Icon name={icon} />
        <span className="tb-group-label">{label}</span>
        <span className="tb-count">
          {stuck > 0 && <span className="tb-count-stuck">{stuck} 卡住・</span>}
          {items.length}
        </span>
      </summary>
      <ul className="tb-rows">
        {items.map((it) => (
          <Row key={it.key} it={it} now={now} owners={owners} />
        ))}
      </ul>
    </details>
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
        <span className="tb-group-label">在等你</span>
        <span className="tb-count tb-count-strong">{items.length}</span>
      </summary>
      <ul className="tb-rows">
        {items.map((w, i) => {
          const { num, title } = splitNumber(w.title, w.url);
          return (
            <li key={i} className="tb-row" title={`${w.title}\n${WAIT_KIND[w.kind]}・@${w.from}・${waitedFor(w.since, now)}`}>
              {num && <span className="tb-num">#{num}</span>}
              <Ext href={w.url} className="tb-title">
                {title}
              </Ext>
              <span className="sr-only">（{WAIT_KIND[w.kind]}，@{w.from} 在等，{waitedFor(w.since, now)}）</span>
              <span className="tb-meta" aria-hidden="true">
                <span className="tb-kind">{WAIT_KIND[w.kind]}</span>
                {/* Who is waiting: a face, so it still shows at side-panel width. */}
                <Avatar login={w.from} size={16} />
                <span>{waitedFor(w.since, now).replace(/^等了 /, "")}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** Things that wait on you (login compared without case), oldest first. */
export function waitingOnMe(board: ProjectBoard): WaitingItem[] {
  const me = board.me.toLowerCase();
  return board.waiting.filter((w) => w.to.toLowerCase() === me).sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

export function TaskBoard({ board, now }: { board: ProjectBoard; now: number }) {
  const me = board.me.toLowerCase();
  const waits = waitingOnMe(board);
  const items = collect(board);
  const open = items.filter((it) => it.state !== "done");
  const done = items.filter((it) => it.state === "done");
  const isMine = (it: Item) => it.owners.some((o) => o.toLowerCase() === me);
  const mine = open.filter(isMine);
  const theirs = open.filter((it) => !isMine(it));

  if (items.length === 0 && waits.length === 0) {
    return (
      <div className="tb">
        <p className="tb-empty-note">還沒有任務。跟你的 AI 說要開什麼任務，或直接在 GitHub 開 issue。</p>
      </div>
    );
  }
  return (
    <div className="tb">
      {waits.length > 0 && <WaitGroup items={waits} now={now} />}
      <Group label="你負責的" icon="working" open items={mine} now={now} owners={false} />
      {/* With nothing of your own and nothing waiting, your teammates' work is the useful first screen. */}
      <Group label="隊友負責的" icon="task" open={mine.length === 0 && waits.length === 0} items={theirs} now={now} owners />
      {done.length > 0 && <Group label="最近完成" icon="done" open={false} items={done} now={now} owners done />}
    </div>
  );
}
