import type { TaskSummary } from "@tandem/contracts";
import { Ext, Section } from "./Ext.tsx";

export function Tasks({ items }: { items: TaskSummary[] }) {
  const open = items.filter((t) => t.state === "open");
  return (
    <Section title="任務" count={open.length}>
      {open.length === 0 ? (
        <p className="muted">目前沒有開著的任務</p>
      ) : (
        <ul className="list card">
          {open.map((t) => (
            <li key={t.number}>
              <Ext href={t.url}>
                #{t.number} {t.title}
              </Ext>
              {t.blockedBy.length > 0 && (
                <>
                  {" "}
                  <span className="badge badge-bad">被卡住：{t.blockedBy.map((n) => `#${n}`).join("、")}</span>
                </>
              )}
              <div className="meta muted">
                {t.assignees.length > 0 ? `負責：${t.assignees.map((l) => `@${l}`).join("、")}` : "還沒有人負責"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
