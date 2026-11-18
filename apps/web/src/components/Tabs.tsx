import { useRef, type KeyboardEvent } from "react";

/** The three board tabs. The order is the order on screen; the board opens on the first. */
export type BoardTab = "tasks" | "people" | "decisions";

export const BOARD_TABS: { id: BoardTab; label: string }[] = [
  { id: "tasks", label: "任務" },
  { id: "people", label: "隊友" },
  { id: "decisions", label: "決定" },
];

export const TAB_LABEL = Object.fromEntries(BOARD_TABS.map((t) => [t.id, t.label])) as Record<BoardTab, string>;

/** id of the panel the tabs control; the board content carries it. */
export const TAB_PANEL = "board-panel";
export const tabId = (t: BoardTab) => `board-tab-${t}`;

/**
 * Three equal segments under the top bar. Only 任務 carries a number: how many things wait on you.
 * 隊友 carries a small dot when a teammate's status says they are stuck (`stuck` holds their logins).
 * Arrow keys, Home and End move between tabs (one tab stop, like any tab list).
 */
export function BoardTabs({ tab, waiting, stuck, onTab }: { tab: BoardTab; waiting: number; stuck: string[]; onTab: (t: BoardTab) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = BOARD_TABS.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    onTab(BOARD_TABS[to]!.id);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  };
  return (
    <div className="bt" role="tablist" aria-label="看板" ref={ref}>
      {BOARD_TABS.map((t, i) => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-selected={on}
            aria-controls={on ? TAB_PANEL : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => onTab(t.id)}
            onKeyDown={(e) => move(e, i)}
          >
            {t.label}
            {t.id === "tasks" && waiting > 0 && (
              <>
                <span className="bt-count" aria-hidden="true">
                  {waiting}
                </span>
                <span className="sr-only">，{waiting} 件在等你</span>
              </>
            )}
            {t.id === "people" && stuck.length > 0 && (
              <>
                <span className="bt-dot" aria-hidden="true" />
                <span className="sr-only">，{stuck.map((l) => `@${l}`).join("、")} 卡住</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
