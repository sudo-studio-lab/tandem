import type { WaitingItem } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Avatar, Panel } from "./ui.tsx";
import { waitedFor } from "../time.ts";

const KIND: Record<WaitingItem["kind"], string> = {
  discussion: "討論",
  pr_review: "審查",
  blocked_issue: "任務",
};

/** The one place on the board that lists who is waiting on whom. */
export function Waiting({ items, now }: { items: WaitingItem[]; now: number }) {
  const sorted = [...items].sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  return (
    <Panel title="誰在等誰" icon="⏳" count={items.length} tone="warn">
      {sorted.length === 0 ? (
        <p className="muted empty">目前沒有人在等人 👍</p>
      ) : (
        <ul className="rows card">
          {sorted.map((w, i) => (
            <li key={i} className="wait-row">
              <span className="wait-who" aria-label={`@${w.from} 在等 @${w.to}`}>
                <Avatar login={w.from} size={24} />
                <span className="wait-arrow" aria-hidden="true">
                  →
                </span>
                <Avatar login={w.to} size={24} />
              </span>
              <span className="grow">
                <Ext href={w.url}>{w.title}</Ext>
                <span className="row-meta">
                  <span className="tag">{KIND[w.kind]}</span> @{w.from} 等 @{w.to}
                </span>
              </span>
              <span className="muted small nowrap">{waitedFor(w.since, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
