import { useRef, type KeyboardEvent } from "react";

/**
 * The four board tabs, one per kind of thing: work, talk, what was decided (and the shared notes
 * behind it), and the people. The order is the order on screen; the board opens on the first.
 */
export type BoardTab = "tasks" | "talk" | "decisions" | "people";

export const BOARD_TABS: { id: BoardTab; label: string }[] = [
  { id: "tasks", label: "任務" },
  { id: "talk", label: "對話" },
  { id: "decisions", label: "決定" },
  { id: "people", label: "隊友" },
];

export const TAB_LABEL = Object.fromEntries(BOARD_TABS.map((t) => [t.id, t.label])) as Record<BoardTab, string>;

/** id of the panel the tabs control; the board content carries it. */
export const TAB_PANEL = "board-panel";
export const tabId = (t: BoardTab) => `board-tab-${t}`;

/** Spoken after a tab's number: what the number counts. */
const COUNT_WORDS: Partial<Record<BoardTab, string>> = { tasks: "件在等你", talk: "則要你回" };

/**
 * Four equal segments under the top bar. 任務 and 對話 carry a number: what waits on you there
 * (each thing counted in one tab only). 隊友 carries a small dot when a teammate is stuck on
 * something outside the team (`stuck` holds their logins). Arrow keys, Home and End move between
 * tabs (one tab stop, like any tab list).
 */
export function BoardTabs({ tab, counts, stuck, onTab }: { tab: BoardTab; counts: Partial<Record<BoardTab, number>>; stuck: string[]; onTab: (t: BoardTab) => void }) {
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
        const count = counts[t.id] ?? 0;
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
            {count > 0 && (
              <>
                <span className="bt-count" aria-hidden="true">
                  {count}
                </span>
                <span className="sr-only">
                  ，{count} {COUNT_WORDS[t.id]}
                </span>
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
