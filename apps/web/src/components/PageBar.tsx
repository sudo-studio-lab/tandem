import { useEffect, useRef, type ReactNode } from "react";
import { Glyph } from "./icons.tsx";

/** The name of the home page (the task board). Every back link and the header use it, so a rename is one edit. */
export const HOME = "看板";

/** "‹ 看板": a quiet back link, chevron and the name of the page it returns to. */
export function Back({ label = HOME, onClick }: { label?: string; onClick: () => void }) {
  return (
    <button type="button" className="pg-back" onClick={onClick}>
      <Glyph name="chevron" size={12} className="pg-back-ic" />
      {label}
    </button>
  );
}

/**
 * The top row of a page reached from the board: back link on the left, then the page title,
 * then anything the page puts at the end (children).
 */
export function PageBar({ back = HOME, title, titleId, onBack, children }: { back?: string; title?: string; titleId?: string; onBack: () => void; children?: ReactNode }) {
  // Opening a page moves focus to its title, so keyboard and screen-reader users start there.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  return (
    <div className="pg-bar">
      <Back label={back} onClick={onBack} />
      {title && (
        <h2 id={titleId} ref={heading} tabIndex={-1} className="pg-title" title={title}>
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
