import type { WaitingItem } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
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
    <section className="mine" aria-labelledby="mine-h">
      <h2 id="mine-h">有 {mine.length} 件事在等你</h2>
      <ul>
        {mine.map((w, i) => (
          <li key={i}>
            <span className="badge">{KIND[w.kind]}</span> @{w.from}：<Ext href={w.url}>{w.title}</Ext>{" "}
            <span className="muted">（{waitedFor(w.since, now)}）</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
