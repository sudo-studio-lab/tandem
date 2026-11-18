import type { WaitingItem } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Group } from "./Group.tsx";
import { waitedFor } from "../time.ts";

const KIND: Record<WaitingItem["kind"], string> = {
  discussion: "討論",
  pr_review: "審查",
  blocked_issue: "任務",
};

/** Who is waiting on whom, across the team. Oldest wait first. */
export function Waiting({ items, now }: { items: WaitingItem[]; now: number }) {
  const sorted = [...items].sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  return (
    <Group label="誰在等誰" count={sorted.length}>
      {sorted.map((w, i) => {
        const who = `@${w.from} 等 @${w.to}`;
        return (
          <li key={i} className="tb-row" title={`${w.title}\n${KIND[w.kind]}・${who}・${waitedFor(w.since, now)}`}>
            <Ext href={w.url} className="tb-title">
              {w.title}
              <span className="sr-only">（{KIND[w.kind]}，{who}）</span>
            </Ext>
            <span className="tb-meta">
              <span className="tb-kind">{KIND[w.kind]}</span>
              <span>
                <span className="tb-from">
                  @{w.from} → @{w.to}・
                </span>
                {waitedFor(w.since, now).replace(/^等了 /, "")}
              </span>
            </span>
          </li>
        );
      })}
    </Group>
  );
}
