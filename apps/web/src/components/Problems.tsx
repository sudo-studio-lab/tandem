import type { Problem } from "@tandem/contracts";
import { Glyph } from "./icons.tsx";

/** Record format warnings: a small collapsed note at the bottom of the board. */
export function Problems({ items }: { items: Problem[] }) {
  if (items.length === 0) return null;
  const errors = items.filter((p) => p.severity === "error").length;
  return (
    <details className={`problems${errors ? " has-errors" : ""}`}>
      <summary>
        <Glyph name="chevron" size={12} className="problems-chev" />
        {items.length} 筆紀錄的格式要修正{errors ? `（${errors} 筆是錯誤）` : ""}，點開看
      </summary>
      <ul className="rows card">
        {items.map((p, i) => (
          <li key={i}>
            <span className="grow">
              <span className={`tag ${p.severity === "error" ? "tag-bad" : "tag-warn"}`}>{p.severity === "error" ? "錯誤" : "警告"}</span> {p.message}
              <span className="row-meta mono">{p.path}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
