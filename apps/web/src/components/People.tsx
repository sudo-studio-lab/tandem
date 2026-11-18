import type { ActivityItem, ActivityKind, BoardMember, ProjectBoard } from "@tandem/contracts";
import { Glyph } from "./icons.tsx";
import { Ext } from "./Ext.tsx";
import { Avatar } from "./ui.tsx";
import { relTime } from "../time.ts";

const DECISION_ID_RE = /^D-\d{8}-[0-9a-z]{4}$/;

const ACTIVITY: Record<ActivityKind, { icon: string; verb: string }> = {
  commit: { icon: "⬆", verb: "上傳了更新" },
  pr_opened: { icon: "◐", verb: "提出修改" },
  pr_merged: { icon: "✔", verb: "修改已合併" },
  comment: { icon: "💬", verb: "留言" },
};

function Activity({ items, now }: { items: ActivityItem[]; now: number }) {
  return (
    <ul className="mini-list">
      {items.map((a, i) => (
        <li key={`${a.url}${i}`}>
          <span className="mini-icon" aria-hidden="true">
            {ACTIVITY[a.kind].icon}
          </span>
          <span className="sr-only">{ACTIVITY[a.kind].verb}：</span>
          <span className="grow">
            <Ext href={a.url}>{a.title}</Ext>
            {a.count && a.count > 1 && <span className="muted"> 等 {a.count} 筆</span>}
          </span>
          <span className="muted mini-time">{relTime(a.time, now)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PersonCard({ m, board, now }: { m: BoardMember; board: ProjectBoard; now: number }) {
  const s = m.status;
  const isMe = m.login === board.me;
  // Decision files live in the data repo (same as the code repo unless .tandem.json says otherwise).
  const repoUrl = board.dataRepo?.url ?? board.repo.url;
  const decisionLink = (ref?: string) => {
    if (!ref || !DECISION_ID_RE.test(ref)) return null;
    const d = board.decisions.find((x) => x.frontmatter.id === ref);
    if (!d) return <span className="muted"> （{ref}）</span>;
    return (
      <>
        {" "}
        <Ext href={`${repoUrl}/blob/HEAD/${d.path}`} className="ref-link">
          {ref}
        </Ext>
      </>
    );
  };
  const prs = m.recentPullRequests.filter((p) => p.state !== "closed");
  const activity = board.activity[m.login] ?? [];
  const outputs = (s?.deliverables.length ?? 0) + prs.length;
  const moreParts = [
    outputs > 0 && `成品 ${outputs}`,
    activity.length > 0 && `動態 ${activity.length}`,
    m.openTasks.length > 0 && `待辦 ${m.openTasks.length}`,
  ].filter(Boolean);

  return (
    <article className={`card person${s?.blocked ? " is-blocked" : ""}${isMe ? " is-me" : ""}`} aria-label={m.login}>
      <header className="person-head">
        <Avatar login={m.login} size={34} />
        <div className="person-name">
          <h3>
            <Ext href={`https://github.com/${m.login}`}>{m.login}</Ext>
            {isMe && <span className="badge badge-me">你</span>}
          </h3>
          <span className="muted small">{s ? `${relTime(s.updated, now)}更新` : activity.length ? "還沒寫狀態" : "最近 7 天沒有動態"}</span>
        </div>
        <div className="person-flags">
          {m.waitedOnBy.length > 0 && (
            <span className="flag flag-warn" title={m.waitedOnBy.map((w) => `@${w.from}：${w.title}`).join("\n")}>
              別人在等 {m.waitedOnBy.length}
            </span>
          )}
          {m.waitingOn.length > 0 && (
            <span className="flag" title={m.waitingOn.map((w) => `@${w.to}：${w.title}`).join("\n")}>
              在等別人 {m.waitingOn.length}
            </span>
          )}
        </div>
      </header>

      {s && (
        <div className="person-body">
          <div className="doing">
            <span className="label">在做</span>
            <p>{s.doing || <span className="muted">—</span>}</p>
          </div>
          {s.blocked && (
            <div className="blocked" role="note">
              <span className="label">卡在</span>
              <p>{s.blocked}</p>
            </div>
          )}
          {s.next && (
            <div className="next">
              <span className="label">接下來</span>
              <p>{s.next}</p>
            </div>
          )}
          {s.fyi.length > 0 && (
            <ul className="fyi">
              {s.fyi.map((f, i) => (
                <li key={i}>
                  <Glyph name="pin" size={14} className="fyi-ic" />
                  <span className="sr-only">要大家知道：</span>
                  {f.text}
                  {decisionLink(f.ref)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {moreParts.length > 0 && (
        <details className="person-more">
          <summary>{moreParts.join(" · ")}</summary>
          {outputs > 0 && (
            <div className="sub-block">
              <h4>成品</h4>
              <ul className="mini-list">
                {s?.deliverables.map((d) => (
                  <li key={d.url}>
                    <Glyph name="doc" size={14} className="mini-icon" />
                    <Ext href={d.url}>{d.title}</Ext>
                  </li>
                ))}
                {prs.map((p) => (
                  <li key={`pr${p.number}`}>
                    <Glyph name="pr" size={14} className="mini-icon" />
                    <span className="grow">
                      <Ext href={p.url}>
                        #{p.number} {p.title}
                      </Ext>
                    </span>
                    <span className={`tag ${p.state === "merged" ? "tag-ok" : "tag-info"}`}>
                      {p.state === "merged" ? "已合併" : p.draft ? "草稿" : "審查中"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {activity.length > 0 && (
            <div className="sub-block">
              <h4>最近動態</h4>
              <Activity items={activity} now={now} />
            </div>
          )}
          {m.openTasks.length > 0 && (
            <div className="sub-block">
              <h4>待辦任務</h4>
              <ul className="mini-list">
                {m.openTasks.map((t) => (
                  <li key={t.number}>
                    <Glyph name="task" size={14} className="mini-icon" />
                    <span className="grow">
                      <Ext href={t.url}>
                        #{t.number} {t.title}
                      </Ext>
                    </span>
                    {t.blockedBy.length > 0 && <span className="tag tag-bad">被卡住</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </details>
      )}
    </article>
  );
}
