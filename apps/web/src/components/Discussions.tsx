import type { DiscussionSummary } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Panel } from "./ui.tsx";
import { relTime } from "../time.ts";

const KIND = { question: "問題", disagreement: "意見不同", other: "討論" } as const;
const TONE = { question: "tag-info", disagreement: "tag-warn", other: "" } as const;

function Row({ d, now }: { d: DiscussionSummary; now: number }) {
  return (
    <li>
      <span className="grow">
        <Ext href={d.url} className="row-title">
          {d.title}
        </Ext>
        <span className="row-meta">
          <span className={`tag ${TONE[d.kind]}`}>{KIND[d.kind]}</span>
          {d.waitingOn.length > 0 && <> 等 {d.waitingOn.map((l) => `@${l}`).join("、")} ·</>}
          {d.answered && <> 已有回答 ·</>} {relTime(d.updatedAt, now)}
        </span>
      </span>
    </li>
  );
}

export function Discussions({ items, now }: { items: DiscussionSummary[]; now: number }) {
  const byUpdated = (a: DiscussionSummary, b: DiscussionSummary) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const open = items.filter((d) => !d.closed).sort(byUpdated);
  const closed = items.filter((d) => d.closed).sort(byUpdated);
  return (
    <Panel title="討論和問題" icon="💬" count={open.length}>
      {open.length === 0 ? (
        <p className="muted empty">目前沒有開著的討論</p>
      ) : (
        <ul className="rows card">
          {open.map((d) => (
            <Row key={d.id} d={d} now={now} />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <details className="more">
          <summary>已結束（{closed.length}）</summary>
          <ul className="rows card dim">
            {closed.map((d) => (
              <Row key={d.id} d={d} now={now} />
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
