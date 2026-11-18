import type { DiscussionSummary } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Group } from "./Group.tsx";
import { Avatar } from "./ui.tsx";
import { relTime } from "../time.ts";

const KIND = { question: "問題", disagreement: "意見不同", other: "討論" } as const;

function Row({ d, now }: { d: DiscussionSummary; now: number }) {
  const waiting = d.waitingOn.map((l) => `@${l}`).join("、");
  return (
    <li className="tb-row" title={d.title}>
      <Ext href={d.url} className="tb-title">
        {d.title}
        {waiting && <span className="sr-only">（等 {waiting} 回答）</span>}
      </Ext>
      <span className="tb-meta">
        <span className={d.kind === "disagreement" ? "lg-hard" : "tb-kind"}>{KIND[d.kind]}</span>
        {/* Who it waits on, as faces, so it still shows at side-panel width. */}
        {d.waitingOn.length > 0 && (
          <span className="tb-wait-who" aria-hidden="true">
            等
            {d.waitingOn.slice(0, 3).map((l) => (
              <Avatar key={l} login={l} size={16} />
            ))}
          </span>
        )}
        {d.answered && <span>已有回答</span>}
        <span>{relTime(d.updatedAt, now)}</span>
      </span>
    </li>
  );
}

/** Open discussions not already listed under 誰在等誰 (`shown` holds those URLs), then the closed ones folded. */
export function Discussions({ items, shown, now }: { items: DiscussionSummary[]; shown: Set<string>; now: number }) {
  const byUpdated = (a: DiscussionSummary, b: DiscussionSummary) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const open = items.filter((d) => !d.closed && !shown.has(d.url)).sort(byUpdated);
  const closed = items.filter((d) => d.closed).sort(byUpdated);
  return (
    <>
      <Group label={shown.size > 0 ? "其他討論" : "討論和問題"} count={open.length}>
        {open.map((d) => (
          <Row key={d.id} d={d} now={now} />
        ))}
      </Group>
      {closed.length > 0 && (
        <Group label="已結束的討論" count={closed.length} open={false} dim>
          {closed.map((d) => (
            <Row key={d.id} d={d} now={now} />
          ))}
        </Group>
      )}
    </>
  );
}
