import type { ReactNode } from "react";
import type { ActivityItem, ActivityKind, BoardMember, ProjectBoard } from "@tandem/contracts";
import { Ext, Section } from "./Ext.tsx";
import { relTime, waitedFor } from "../time.ts";

const DECISION_ID_RE = /^D-\d{8}-[0-9a-z]{4}$/;

const ACTIVITY: Record<ActivityKind, { icon: string; verb: string }> = {
  commit: { icon: "⬆", verb: "上傳了更新" },
  pr_opened: { icon: "◐", verb: "提出修改" },
  pr_merged: { icon: "✔", verb: "修改已合併" },
  comment: { icon: "💬", verb: "留言" },
};

function Activity({ items, now }: { items: ActivityItem[]; now: number }) {
  return (
    <div className="activity">
      <h4>最近動態</h4>
      <ul>
        {items.map((a, i) => (
          <li key={`${a.url}${i}`}>
            <span className="act-icon" aria-hidden="true">
              {ACTIVITY[a.kind].icon}
            </span>
            <span className="sr-only">{ACTIVITY[a.kind].verb}：</span>
            <Ext href={a.url}>{a.title}</Ext>
            {a.count && a.count > 1 && <span className="muted"> 等 {a.count} 筆</span>}
            <span className="muted act-time"> {relTime(a.time, now)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, children, tone }: { label: string; children: ReactNode; tone?: "bad" }) {
  return (
    <div className={`field${tone ? ` field-${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function PersonCard({ m, board, now }: { m: BoardMember; board: ProjectBoard; now: number }) {
  const s = m.status;
  const isMe = m.login === board.me;
  const repoUrl = board.repo.url;
  const decisionLink = (ref?: string) => {
    if (!ref || !DECISION_ID_RE.test(ref)) return null;
    const d = board.decisions.find((x) => x.frontmatter.id === ref);
    if (!d) return <span className="muted"> （{ref}）</span>;
    return (
      <>
        {" "}
        <Ext href={`${repoUrl}/blob/HEAD/${d.path}`}>{ref}</Ext>
      </>
    );
  };
  const prs = m.recentPullRequests.filter((p) => p.state !== "closed");
  const activity = board.activity[m.login] ?? [];

  return (
    <article className={`card person${s?.blocked ? " is-blocked" : ""}`} aria-label={m.login}>
      <header className="person-head">
        <h3>
          <Ext href={`https://github.com/${m.login}`}>@{m.login}</Ext>
        </h3>
        {isMe && <span className="badge badge-me">你</span>}
        <span className="muted updated">{s ? `更新於 ${relTime(s.updated, now)}` : ""}</span>
      </header>

      {!s ? (
        activity.length === 0 && <p className="muted">最近 7 天沒有動態</p>
      ) : (
        <dl className="fields">
          <Field label="在做">{s.doing || <span className="muted">—</span>}</Field>
          <Field label="接下來">{s.next || <span className="muted">—</span>}</Field>
          {s.blocked && (
            <Field label="卡在" tone="bad">
              {s.blocked}
            </Field>
          )}
          {s.fyi.length > 0 && (
            <Field label="要大家知道">
              <ul>
                {s.fyi.map((f, i) => (
                  <li key={i}>
                    {f.text}
                    {decisionLink(f.ref)}
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </dl>
      )}

      {activity.length > 0 && <Activity items={activity} now={now} />}

      {((s && s.deliverables.length > 0) || prs.length > 0) && (
        <dl className="fields">
          <Field label="成品">
            <ul>
              {s?.deliverables.map((d) => (
                <li key={d.url}>
                  <Ext href={d.url}>{d.title}</Ext>
                </li>
              ))}
              {prs.map((p) => (
                <li key={`pr${p.number}`}>
                  <Ext href={p.url}>
                    #{p.number} {p.title}
                  </Ext>{" "}
                  <span className={`badge ${p.state === "merged" ? "badge-ok" : ""}`}>
                    {p.state === "merged" ? "已合併" : p.draft ? "草稿 PR" : "PR 審查中"}
                  </span>
                </li>
              ))}
            </ul>
          </Field>
        </dl>
      )}

      {(m.waitingOn.length > 0 || m.waitedOnBy.length > 0 || m.openTasks.length > 0) && (
        <dl className="fields">
          {m.waitingOn.length > 0 && (
            <Field label="在等誰">
              <ul>
                {m.waitingOn.map((w, i) => (
                  <li key={i}>
                    @{w.to}：<Ext href={w.url}>{w.title}</Ext>{" "}
                    <span className="muted">（{waitedFor(w.since, now)}）</span>
                  </li>
                ))}
              </ul>
            </Field>
          )}
          {m.waitedOnBy.length > 0 && (
            <Field label="誰在等這個人">
              <ul>
                {m.waitedOnBy.map((w, i) => (
                  <li key={i}>
                    @{w.from}：<Ext href={w.url}>{w.title}</Ext>{" "}
                    <span className="muted">（{waitedFor(w.since, now)}）</span>
                  </li>
                ))}
              </ul>
            </Field>
          )}
          {m.openTasks.length > 0 && (
            <Field label="待辦任務">
              <ul>
                {m.openTasks.map((t) => (
                  <li key={t.number}>
                    <Ext href={t.url}>
                      #{t.number} {t.title}
                    </Ext>
                    {t.blockedBy.length > 0 && <span className="badge badge-bad">被卡住</span>}
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </dl>
      )}
    </article>
  );
}

export function People({ board, now }: { board: ProjectBoard; now: number }) {
  const members = [...board.members].sort((a, b) => Number(b.login === board.me) - Number(a.login === board.me));
  return (
    <Section title="大家在做什麼" count={members.length}>
      {members.length === 0 ? (
        <p className="muted">還沒有成員</p>
      ) : (
        <div className="grid">
          {members.map((m) => (
            <PersonCard key={m.login} m={m} board={board} now={now} />
          ))}
        </div>
      )}
    </Section>
  );
}
