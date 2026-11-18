import type { WaitingItem } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Group } from "./Group.tsx";
import { Avatar } from "./ui.tsx";
import { Glyph } from "./icons.tsx";
import { waitedFor } from "../time.ts";

const KIND: Record<WaitingItem["kind"], string> = {
  discussion: "討論",
  pr_review: "審查",
  blocked_issue: "任務",
};

/** Who is waiting on whom, across the team. Oldest wait first; rows waiting on me are tinted. */
export function Waiting({ items, me, now }: { items: WaitingItem[]; me: string; now: number }) {
  const sorted = [...items].sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  const mine = (w: WaitingItem) => w.to.toLowerCase() === me.toLowerCase();
  return (
    <Group label="誰在等誰" count={sorted.length}>
      {sorted.map((w, i) => {
        const who = `@${w.from} 等 ${mine(w) ? "你" : `@${w.to}`}`;
        return (
          <li key={i} className={`tb-row${mine(w) ? " is-mine" : ""}`} title={`${w.title}\n${KIND[w.kind]}・${who}・${waitedFor(w.since, now)}`}>
            <Ext href={w.url} className="tb-title">
              {w.title}
              <span className="sr-only">（{KIND[w.kind]}，{who}）</span>
            </Ext>
            <span className="tb-meta">
              <span className="tb-kind">{KIND[w.kind]}</span>
              {/* Faces stay visible at side-panel width; the names are in the title and for screen readers. */}
              <span className="lg-who" aria-hidden="true">
                <Avatar login={w.from} size={16} />
                <Glyph name="arrow" size={12} className="lg-arrow" />
                <Avatar login={w.to} size={16} />
              </span>
              <span>{waitedFor(w.since, now).replace(/^等了 /, "")}</span>
            </span>
          </li>
        );
      })}
    </Group>
  );
}
