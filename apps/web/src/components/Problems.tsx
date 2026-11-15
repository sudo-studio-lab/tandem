import type { Problem } from "@tandem/contracts";

/** Record format warnings: a small collapsed note at the bottom of the board. */
export function Problems({ items }: { items: Problem[] }) {
  if (items.length === 0) return null;
  const errors = items.filter((p) => p.severity === "error").length;
  return (
    <details className={`problems${errors ? " has-errors" : ""}`}>
      <summary>
        <span aria-hidden="true">⚠ </span>
        {items.length} 個紀錄格式問題{errors ? `（${errors} 個錯誤）` : ""}      </summary>
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
