import type { ActivityKind, BoardMember, ProjectBoard, WaitingItem } from "@tandem/contracts";
import { Glyph } from "./icons.tsx";
import { Ext } from "./Ext.tsx";
import { Avatar } from "./ui.tsx";
import { collect, type Item } from "./TaskBoard.tsx";
import { relTime, waitedFor } from "../time.ts";

/*
 * The 隊友 tab: one section per person (teammates first, you last), holding only what belongs to
 * that person: their status, who they are waiting on, what they made, what they did lately. Their
 * tasks live in 任務; here a single line counts them. Each thing on the board has one home, and a
 * wait on you is the accent colour everywhere; red is only for being stuck on something else.
 */

/** A status older than this is shown in the warning colour: the teammate may have moved on. */
const STALE_MS = 2 * 24 * 3600_000;

const ACTIVITY: Record<ActivityKind, string> = {
  commit: "上傳了更新",
  pr_opened: "提出修改",
  pr_merged: "修改已合併",
  comment: "留言",
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Their status says they are stuck because of you: a wait on you is shown as one, never in red. */
function stuckOnMe(m: BoardMember, board: ProjectBoard): boolean {
  const blocked = (m.status?.blocked ?? "").toLowerCase();
  return board.waiting.some((w) => same(w.from, m.login) && same(w.to, board.me)) || blocked.includes(`@${board.me.toLowerCase()}`);
}

/**
 * Teammates (not you) stuck on something outside the team. The 隊友 tab marks itself when there
 * are any; being stuck on you already counts in 任務 or 對話.
 */
export function blockedTeammates(board: ProjectBoard): string[] {
  return board.members.filter((m) => !same(m.login, board.me) && !!m.status?.blocked && !stuckOnMe(m, board)).map((m) => m.login);
}

const WAIT_WHAT: Record<WaitingItem["kind"], string> = { discussion: "回答", pr_review: "審查", blocked_issue: "完成任務" };

function Person(props: { m: BoardMember; board: ProjectBoard; items: Item[]; now: number; onShowTasks: () => void; onOpenDecision: (id: string) => void; onOpenRoom: (n: number) => void }) {
  const { m, board, items, now } = props;
  const s = m.status;
  const isMe = same(m.login, board.me);
  const stale = !!s && now - Date.parse(s.updated) > STALE_MS;
  // A status file that fails to parse comes back as a problem, not a status: say so instead of "no status".
  const broken = !s && board.problems.some((p) => p.path.toLowerCase().endsWith(`/status/${m.login.toLowerCase()}.md`));
  const work = items.filter((it) => it.state !== "done" && it.owners.some((o) => same(o, m.login)));
  const stuckWork = work.filter((it) => it.blocked).length;
  const deliverables = s?.deliverables ?? [];
  const activity = board.activity[m.login] ?? [];
  const waits = board.waiting.filter((w) => same(w.from, m.login)).sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  const onMe = stuckOnMe(m, board);
  // A room is a discussion in the team data repo: open it here instead of on GitHub.
  const roomOf = (url: string): number | null => {
    const base = board.dataRepo?.url;
    const hit = base && url.startsWith(`${base}/discussions/`) ? /^(\d+)/.exec(url.slice(base.length + "/discussions/".length)) : null;
    return hit ? Number(hit[1]) : null;
  };

  return (
    <section className="mt" aria-labelledby={`mt-${m.login}`}>
      <div className="mt-who">
        <Avatar login={m.login} size={28} />
        <h3 id={`mt-${m.login}`} className="mt-h">
          <Ext href={`https://github.com/${m.login}`} className="mt-name">
            @{m.login}
          </Ext>
          {isMe && <span className="mt-me">你</span>}
        </h3>
        <span className={`mt-when${stale || broken ? " is-old" : ""}`}>
          {s ? `${relTime(s.updated, now)}更新` : broken ? "狀態檔格式要修正" : "還沒寫狀態"}
        </span>
      </div>

      {isMe && !s && !broken && <p className="mt-line">跟你的 AI 說「更新我的狀態」。</p>}
      {s?.doing && <p className="mt-doing">{s.doing}</p>}
      {waits.map((w, i) => (
        <p key={i} className={`mt-line${same(w.to, board.me) ? " mt-wait-me" : ""}`}>
          <span className="mt-k">{same(w.to, board.me) ? "等你" : `等 @${w.to}`}</span>
          <span>
            {WAIT_WHAT[w.kind]}：
            <Ext href={w.url} className="mt-wait-link">
              {w.title}
            </Ext>
            <span className="mt-since">・{waitedFor(w.since, now).replace(/^等了 /, "")}</span>
          </span>
        </p>
      ))}
      {s?.blocked && (
        <p className={`mt-line${onMe ? "" : " mt-blocked"}`}>
          <span className="mt-k">卡在</span>
          {s.blocked}
        </p>
      )}
      {s?.next && (
        <p className="mt-line">
          <span className="mt-k">下一步</span>
          {s.next}
        </p>
      )}
      {s && s.fyi.length > 0 && (
        <ul className="mt-fyi">
          {s.fyi.map((f, i) => (
            <li key={i}>
              <Glyph name="pin" size={12} className="mt-pin" />
              <span className="sr-only">要大家知道：</span>
              {(() => {
                const d = f.ref ? board.decisions.find((x) => x.frontmatter.id === f.ref) : undefined;
                return d ? (
                  <button type="button" className="tb-link mt-fyi-link" title="在「決定」打開" onClick={() => props.onOpenDecision(d.frontmatter.id)}>
                    {f.text}
                  </button>
                ) : (
                  <span>{f.text}</span>
                );
              })()}
            </li>
          ))}
        </ul>
      )}

      {work.length > 0 && (
        <p className="mt-line">
          <span className="mt-k">任務</span>
          <span>
            手上 {work.length} 件{stuckWork > 0 && <span className="mt-stuck">・{stuckWork} 件卡住</span>}
            <button type="button" className="tb-link mt-to-tasks" onClick={props.onShowTasks}>
              看任務
            </button>
          </span>
        </p>
      )}
      {deliverables.length > 0 && (
        <ul className="tb-rows mt-work" aria-label={`@${m.login} 的成品`}>
          {deliverables.map((d) => {
            const room = roomOf(d.url);
            return (
              <li key={d.url} className="tb-row" title={d.title}>
                <span className="tb-num" aria-hidden="true">
                  <Glyph name="doc" size={14} className="mt-doc" />
                </span>
                {room !== null ? (
                  <button type="button" className="tb-title tk-open" onClick={() => props.onOpenRoom(room)}>
                    {d.title}
                  </button>
                ) : (
                  <Ext href={d.url} className="tb-title">
                    {d.title}
                  </Ext>
                )}
                {room !== null && <span className="tb-meta">房間</span>}
              </li>
            );
          })}
        </ul>
      )}

      {activity.length > 0 && (
        <details className="mt-more">
          <summary>
            <Glyph name="chevron" size={12} className="tb-chev" />
            最近動態 {activity.length}
          </summary>
          <ul className="tb-rows">
            {activity.map((a, i) => (
              <li key={`${a.url}${i}`} className="tb-row" title={a.title}>
                <Ext href={a.url} className="tb-title">
                  {a.title}
                </Ext>
                <span className="tb-meta">
                  <span>
                    {ACTIVITY[a.kind]}
                    {a.count && a.count > 1 ? ` ${a.count} 筆` : ""}
                  </span>
                  <span>{relTime(a.time, now)}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function Teammates(props: { board: ProjectBoard; now: number; onInvite: () => void; onShowTasks: () => void; onOpenDecision: (id: string) => void; onOpenRoom: (n: number) => void }) {
  const { board, now, onInvite } = props;
  const people = [...board.members].sort((a, b) => Number(same(a.login, board.me)) - Number(same(b.login, board.me)));
  const items = collect(board);
  return (
    <div className="tb">
      {people.map((m) => (
        <Person key={m.login} m={m} board={board} items={items} now={now} onShowTasks={props.onShowTasks} onOpenDecision={props.onOpenDecision} onOpenRoom={props.onOpenRoom} />
      ))}
      {people.length < 2 ? (
        <p className="tb-empty-note">
          還沒有隊友。
          <button type="button" className="tb-link" onClick={onInvite}>
            邀請隊友
          </button>
        </p>
      ) : (
        <button type="button" className="ctl mt-members" onClick={onInvite}>
          <Glyph name="plus" />
          <span>邀請與成員</span>
        </button>
      )}
    </div>
  );
}
