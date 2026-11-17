import type { BoardData, Decision, Strength } from "@tandem/contracts";
import { Ext } from "./Ext.tsx";
import { Panel } from "./ui.tsx";

const STRENGTH: Record<Strength, string> = {
  hard: "不能違反",
  preference: "傾向",
  hunch: "直覺",
  "one-off": "只限這次",
};

/** How many current decisions show before "更多". */
const SHOWN = 6;

function DecisionItem({ d, board }: { d: Decision; board: BoardData }) {
  const f = d.frontmatter;
  // Decision files live in the data repo (same as the code repo unless .tandem.json says otherwise).
  const repoUrl = board.dataRepo?.url ?? board.repo.url;
  const superseded = d.supersededBy.length > 0;
  return (
    <li className={superseded ? "dim" : undefined}>
      <details className="decision">
        <summary>
          <span className="d-line">
            <span className="d-title">{f.title}</span>
            <span className={`tag tag-${f.strength}`}>{STRENGTH[f.strength]}</span>
          </span>
          <span className="row-meta">
            {f.date.slice(5).replace("-", "/")} · {f.deciders.map((l) => `@${l}`).join("、")}
            {superseded && <> · 已被 {d.supersededBy.join("、")} 取代</>}
          </span>
        </summary>
        <div className="d-body">
          {d.quotes.length > 0 ? (
            d.quotes.map((q, i) => (
              <blockquote key={i}>
                <p>「{q.text}」</p>
                <footer>
                  — @{q.by}
                  {q.relayedBy && <span className="tag">轉述（@{q.relayedBy}）</span>}
                  {/^https?:\/\//.test(q.source) && (
                    <>
                      {" "}
                      · <Ext href={q.source}>來源</Ext>
                    </>
                  )}
                </footer>
              </blockquote>
            ))
          ) : (
            d.noQuoteBy && <p className="muted small">沒有原話（由 @{d.noQuoteBy} 的 agent 整理）</p>
          )}
          <h4>決定</h4>
          <p>{d.decision}</p>
          <h4>原因</h4>
          <p>{d.why}</p>
          <p className="row-meta">
            <Ext href={`${repoUrl}/blob/HEAD/${d.path}`}>在 GitHub 上看</Ext> · {f.id}
          </p>
        </div>
      </details>
    </li>
  );
}

export function Decisions({ board }: { board: BoardData }) {
  const sorted = [...board.decisions].sort((a, b) =>
    a.frontmatter.date === b.frontmatter.date
      ? b.frontmatter.id.localeCompare(a.frontmatter.id)
      : b.frontmatter.date.localeCompare(a.frontmatter.date),
  );
  // Current decisions first; replaced ones only under "更多".
  const current = sorted.filter((d) => d.supersededBy.length === 0);
  const rest = [...current.slice(SHOWN), ...sorted.filter((d) => d.supersededBy.length > 0)];
  return (
    <Panel title="決定" icon="✅" count={current.length}>
      {sorted.length === 0 ? (
        <p className="muted empty">還沒有記錄任何決定</p>
      ) : (
        <>
          <ul className="rows card">
            {current.slice(0, SHOWN).map((d) => (
              <DecisionItem key={d.frontmatter.id} d={d} board={board} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="more">
              <summary>更早的和已被取代的（{rest.length}）</summary>
              <ul className="rows card">
                {rest.map((d) => (
                  <DecisionItem key={d.frontmatter.id} d={d} board={board} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Panel>
  );
}
