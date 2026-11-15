import type { Problem } from "@tandem/contracts";
import { Section } from "./Ext.tsx";

export function Problems({ items }: { items: Problem[] }) {
  if (items.length === 0) return null;
  return (
    <Section title="紀錄問題" count={items.length}>
      <ul className="list card">
        {items.map((p, i) => (
          <li key={i}>
            <span className={`badge ${p.severity === "error" ? "badge-bad" : "badge-warn"}`}>
              {p.severity === "error" ? "錯誤" : "警告"}
            </span>{" "}
            {p.message}
            <div className="meta muted">{p.path}</div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
