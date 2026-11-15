import type { DiscussionSummary } from "@tandem/contracts";
import { Ext, Section } from "./Ext.tsx";
import { relTime } from "../time.ts";

const KIND = { question: "問題", disagreement: "意見不同", other: "討論" } as const;

function Row({ d, now }: { d: DiscussionSummary; now: number }) {
  const tone = d.kind === "disagreement" ? "badge-warn" : d.kind === "question" ? "badge-info" : "";
  return (
    <li>
      <span className={`badge ${tone}`}>{KIND[d.kind]}</span> <Ext href={d.url}>{d.title}</Ext>
      <div className="meta muted">
        @{d.author} 發起
        {d.waitingOn.length > 0 && <> · 等 {d.waitingOn.map((l) => `@${l}`).join("、")}</>}
        {d.answered && <> · 已有回答</>} · {relTime(d.updatedAt, now)}更新
      </div>
    </li>
  );
}

export function Discussions({ items, now }: { items: DiscussionSummary[]; now: number }) {
  const byUpdated = (a: DiscussionSummary, b: DiscussionSummary) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const open = items.filter((d) => !d.closed).sort(byUpdated);
  const closed = items.filter((d) => d.closed).sort(byUpdated);
  return (
    <Section title="討論" count={open.length}>
      {open.length === 0 ? (
        <p className="muted">目前沒有開著的討論</p>
      ) : (
        <ul className="list card">
          {open.map((d) => (
            <Row key={d.id} d={d} now={now} />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <details className="more">
          <summary>最近已結束的討論（{closed.length}）</summary>
          <ul className="list card dim">
            {closed.map((d) => (
              <Row key={d.id} d={d} now={now} />
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
