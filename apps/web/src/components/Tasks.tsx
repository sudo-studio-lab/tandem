import type { TaskSummary } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Panel } from "./ui.tsx";

export function Tasks({ items }: { items: TaskSummary[] }) {
  const open = items.filter((t) => t.state === "open");
  return (
    <Panel title="任務" icon="☑" count={open.length}>
      {open.length === 0 ? (
        <p className="muted empty">目前沒有開著的任務</p>
      ) : (
        <ul className="rows card">
          {open.map((t) => (
            <li key={t.number}>
              <span className="grow">
                <Ext href={t.url} className="row-title">
                  <span className="muted">#{t.number}</span> {t.title}
                </Ext>
                <span className="row-meta">
                  {t.blockedBy.length > 0 && <span className="tag tag-bad">被 {t.blockedBy.map((n) => `#${n}`).join("、")} 卡住</span>}{" "}
                  {t.assignees.length > 0 ? t.assignees.map((l) => `@${l}`).join("、") : "還沒有人負責"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
