import type { WaitingItem } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Avatar } from "./ui.tsx";
import { waitedFor } from "../time.ts";

const KIND: Record<WaitingItem["kind"], string> = {
  discussion: "請你回答",
  pr_review: "請你審查",
  blocked_issue: "等你完成",
};

/** Things waiting on me: always the first thing on the board. */
export function Mine({ items, me, now }: { items: WaitingItem[]; me: string; now: number }) {
  const mine = items.filter((w) => w.to === me).sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  if (mine.length === 0) return null;
  return (
    <section className="attention" aria-labelledby="mine-h">
      <h2 id="mine-h">
        <span aria-hidden="true">🔔 </span>有 {mine.length} 件事在等你
      </h2>
      <ul className="attention-list">
        {mine.map((w, i) => (
          <li key={i}>
            <Ext href={w.url} className="attention-item">
              <Avatar login={w.from} size={26} />
              <span className="grow">
                <span className="attention-kind">{KIND[w.kind]}</span>
                <span className="attention-title">{w.title}</span>
                <span className="attention-meta">
                  @{w.from} · {waitedFor(w.since, now)}
                </span>
              </span>
              <span className="attention-go" aria-hidden="true">
                →
              </span>
            </Ext>
          </li>
        ))}
      </ul>
    </section>
  );
}
