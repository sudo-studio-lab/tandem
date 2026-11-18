import type { ActivityKind, BoardMember, ProjectBoard } from "@tandem/contracts";
import { Glyph } from "./icons.tsx";
import { Ext } from "./Ext.tsx";
import { Avatar } from "./ui.tsx";
import { Waiting } from "./Waiting.tsx";
import { collect, Row, type Item } from "./TaskBoard.tsx";
import { relTime } from "../time.ts";

/*
 * The 隊友 tab: who waits on whom, then one section per person (teammates
 * first, you last). Each section is what that person's status says, then the
 * work in their hands with the same rows as the 任務 tab.
 */

const DECISION_ID_RE = /^D-\d{8}-[0-9a-z]{4}$/;

/** A status older than this is shown in the warning colour: the teammate may have moved on. */
const STALE_MS = 2 * 24 * 3600_000;

const ACTIVITY: Record<ActivityKind, string> = {
  commit: "上傳了更新",
  pr_opened: "提出修改",
  pr_merged: "修改已合併",
  comment: "留言",
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Teammates (not you) whose status says they are stuck. The 隊友 tab marks itself when there are any. */
export function blockedTeammates(board: ProjectBoard): string[] {
  return board.members.filter((m) => !same(m.login, board.me) && !!m.status?.blocked).map((m) => m.login);
}

function Person({ m, board, items, now }: { m: BoardMember; board: ProjectBoard; items: Item[]; now: number }) {
  const s = m.status;
  const isMe = same(m.login, board.me);
  const stale = !!s && now - Date.parse(s.updated) > STALE_MS;
  // A status file that fails to parse comes back as a problem, not a status: say so instead of "no status".
  const broken = !s && board.problems.some((p) => p.path.toLowerCase().endsWith(`/status/${m.login.toLowerCase()}.md`));
  // Decision files live in the data repo (same as the code repo unless .tandem.json says otherwise).
  const repoUrl = board.dataRepo?.url ?? board.repo.url;
  const decisionLink = (ref?: string) => {
    if (!ref || !DECISION_ID_RE.test(ref)) return null;
    const d = board.decisions.find((x) => x.frontmatter.id === ref);
    return d ? (
      <Ext href={`${repoUrl}/blob/HEAD/${d.path}`} className="ref-link">
        {ref}
      </Ext>
    ) : (
      <span className="mt-ref">{ref}</span>
    );
  };
  const work = items.filter((it) => it.state !== "done" && it.owners.some((o) => same(o, m.login)));
  const deliverables = s?.deliverables ?? [];
  const activity = board.activity[m.login] ?? [];

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
      {s?.blocked && (
        <p className="mt-line mt-blocked">
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
              <span>
                {f.text} {decisionLink(f.ref)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {work.length + deliverables.length > 0 && (
        <ul className="tb-rows mt-work" aria-label={`@${m.login} 手上的工作`}>
          {work.map((it) => (
            <Row key={it.key} it={it} now={now} owners={false} />
          ))}
          {deliverables.map((d) => (
            <li key={d.url} className="tb-row" title={d.title}>
              <span className="tb-num" aria-hidden="true">
                <Glyph name="doc" size={14} className="mt-doc" />
              </span>
              <Ext href={d.url} className="tb-title">
                {d.title}
              </Ext>
              <span className="tb-meta">成品</span>
            </li>
          ))}
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

export function Teammates({ board, now, onInvite }: { board: ProjectBoard; now: number; onInvite: () => void }) {
  const people = [...board.members].sort((a, b) => Number(same(a.login, board.me)) - Number(same(b.login, board.me)));
  const items = collect(board);
  return (
    <div className="tb">
      {board.waiting.length > 0 && <Waiting items={board.waiting} me={board.me} now={now} />}
      {people.map((m) => (
        <Person key={m.login} m={m} board={board} items={items} now={now} />
      ))}
      {people.length < 2 && (
        <p className="tb-empty-note">
          還沒有隊友。
          <button type="button" className="tb-link" onClick={onInvite}>
            邀請隊友
          </button>
        </p>
      )}
    </div>
  );
}
