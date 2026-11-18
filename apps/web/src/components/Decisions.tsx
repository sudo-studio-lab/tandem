import { useEffect } from "react";
import type { BoardData, Decision, Strength } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Group } from "./Group.tsx";
import { Glyph } from "./icons.tsx";

const STRENGTH: Record<Strength, string> = {
  hard: "不能違反",
  preference: "傾向",
  hunch: "直覺",
  "one-off": "只限這次",
};

/** How many current decisions show before the folded group. */
const SHOWN = 8;

/** One line per decision; open it to read the original words, the decision and the reason. */
function DecisionRow({ d, board, focused }: { d: Decision; board: BoardData; focused?: boolean }) {
  const f = d.frontmatter;
  // Decision files live in the data repo (same as the code repo unless .tandem.json says otherwise).
  const repoUrl = board.dataRepo?.url ?? board.repo.url;
  const replaced = d.supersededBy.length > 0;
  return (
    <li id={`dec-${f.id}`} className={`lg-dec${replaced ? " is-replaced" : ""}${focused ? " is-focused" : ""}`}>
      <details open={focused || undefined}>
        <summary className="tb-row" title={f.title}>
          <Glyph name="chevron" size={12} className="lg-chev" />
          <span className="tb-title">{f.title}</span>
          <span className="tb-meta">
            {replaced ? <span>已被取代</span> : <span className={f.strength === "hard" ? "lg-hard" : undefined}>{STRENGTH[f.strength]}</span>}
            <span>{f.date.slice(5).replace("-", "/")}</span>
          </span>
        </summary>
        <div className="lg-body">
          {d.quotes.length > 0 ? (
            d.quotes.map((q, i) => (
              <blockquote key={i} className="lg-quote">
                <p>「{q.text}」</p>
                <footer>
                  @{q.by}
                  {q.relayedBy && <>・@{q.relayedBy} 轉述</>}
                  {/^https?:\/\//.test(q.source) && (
                    <>
                      ・<Ext href={q.source}>來源</Ext>
                    </>
                  )}
                </footer>
              </blockquote>
            ))
          ) : (
            d.noQuoteBy && <p className="lg-note">沒有原話，由 @{d.noQuoteBy} 的 AI 整理，參考就好。</p>
          )}
          <p className="lg-label">決定</p>
          <p>{d.decision}</p>
          <p className="lg-label">原因</p>
          <p>{d.why}</p>
          <p className="lg-foot">
            {f.deciders.map((l) => `@${l}`).join("、")}・{f.id}
            {replaced && <>・已被 {d.supersededBy.join("、")} 取代</>}
            ・<Ext href={`${repoUrl}/blob/HEAD/${d.path}`}>在 GitHub 打開</Ext>
          </p>
        </div>
      </details>
    </li>
  );
}

/** `focus`: a decision opened from somewhere else (a teammate's note); it opens and scrolls into view. */
export function Decisions({ board, focus }: { board: BoardData; focus?: string }) {
  const sorted = [...board.decisions].sort((a, b) =>
    a.frontmatter.date === b.frontmatter.date
      ? b.frontmatter.id.localeCompare(a.frontmatter.id)
      : b.frontmatter.date.localeCompare(a.frontmatter.date),
  );
  // Current decisions first; replaced ones only in the folded group.
  const current = sorted.filter((d) => d.supersededBy.length === 0);
  const rest = [...current.slice(SHOWN), ...sorted.filter((d) => d.supersededBy.length > 0)];
  useEffect(() => {
    if (focus) document.getElementById(`dec-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus]);
  return (
    <>
      <Group label="決定" count={current.length}>
        {current.slice(0, SHOWN).map((d) => (
          <DecisionRow key={d.frontmatter.id} d={d} board={board} focused={d.frontmatter.id === focus} />
        ))}
      </Group>
      {rest.length > 0 && (
        <Group label="更早的和已被取代的決定" count={rest.length} open={rest.some((d) => d.frontmatter.id === focus)} dim>
          {rest.map((d) => (
            <DecisionRow key={d.frontmatter.id} d={d} board={board} focused={d.frontmatter.id === focus} />
          ))}
        </Group>
      )}
    </>
  );
}
