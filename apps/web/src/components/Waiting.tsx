import type { WaitingItem } from "@tandem/contracts";
import { Ext, Section } from "./Ext.tsx";
import { waitedFor } from "../time.ts";

const KIND: Record<WaitingItem["kind"], string> = {
  discussion: "討論",
  pr_review: "審查",
  blocked_issue: "任務",
};

export function Waiting({ items, now }: { items: WaitingItem[]; now: number }) {
  const sorted = [...items].sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  return (
    <Section title="在等待" count={items.length}>
      {sorted.length === 0 ? (
        <p className="muted">目前沒有人在等人</p>
      ) : (
        <ul className="list card">
          {sorted.map((w, i) => (
            <li key={i}>
              <span className="badge">{KIND[w.kind]}</span> <strong>@{w.from}</strong> → <strong>@{w.to}</strong>：
              <Ext href={w.url}>{w.title}</Ext> <span className="muted">（{waitedFor(w.since, now)}）</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
