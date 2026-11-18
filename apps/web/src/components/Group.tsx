import type { ReactNode } from "react";
import { Glyph } from "./icons.tsx";

/**
 * One folding group of one-line rows, the same shape as the board's groups: a small muted label,
 * the count on the right, rows underneath. An empty group is a single quiet line.
 */
export function Group({ label, count, open = true, dim, children }: { label: string; count: number; open?: boolean; dim?: boolean; children?: ReactNode }) {
  if (count === 0) {
    return (
      <div className="tb-group tb-group-empty">
        <div className="tb-sum">
          <span className="tb-chev-space" aria-hidden="true" />
          <span className="tb-group-label">{label}</span>
          <span className="tb-count">0</span>
        </div>
      </div>
    );
  }
  return (
    <details className={`tb-group${dim ? " tb-done-group" : ""}`} open={open}>
      <summary className="tb-sum">
        <Glyph name="chevron" size={12} className="tb-chev" />
        <span className="tb-group-label">{label}</span>
        <span className="tb-count">{count}</span>
      </summary>
      <ul className="tb-rows">{children}</ul>
    </details>
  );
}
