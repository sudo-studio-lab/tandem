import type { BoardData, Decision, Strength } from "@tandem/contracts";
import { Ext, Section } from "./Ext.tsx";

const STRENGTH: Record<Strength, string> = {
  hard: "不能違反",
  preference: "傾向",
  hunch: "直覺",
  "one-off": "只限這次",
};

function DecisionItem({ d, board }: { d: Decision; board: BoardData }) {
  const f = d.frontmatter;
  const repoUrl = board.repo.url;
  const superseded = d.supersededBy.length > 0;
  return (
    <li className={superseded ? "dim" : undefined}>
      <details className="decision">
        <summary>
          <span className="d-title">{f.title}</span> <span className={`badge badge-${f.strength}`}>{STRENGTH[f.strength]}</span>
          {superseded && <span className="badge">已被 {d.supersededBy.join("、")} 取代</span>}
          <span className="meta muted">
            {f.date} · {f.deciders.map((l) => `@${l}`).join("、")}
          </span>
        </summary>
        <div className="d-body">
          {d.quotes.length > 0 ? (
            <>
              <h4>原話</h4>
              {d.quotes.map((q, i) => (
                <blockquote key={i}>
                  <p>{q.text}</p>
                  <footer>
                    @{q.by}
                    {q.relayedBy && <span className="badge">轉述（@{q.relayedBy}）</span>}
                    {/^https?:\/\//.test(q.source) && (
                      <>
                        {" "}
                        · <Ext href={q.source}>來源</Ext>
                      </>
                    )}
                  </footer>
                </blockquote>
              ))}
            </>
          ) : (
            d.noQuoteBy && <p className="muted">沒有原話（由 @{d.noQuoteBy} 的 agent 記錄）</p>
          )}
          <h4>決定</h4>
          <p>{d.decision}</p>
          <h4>原因</h4>
          <p>{d.why}</p>
          <p className="meta">
            <Ext href={`${repoUrl}/blob/HEAD/${d.path}`}>在 GitHub 上看這份紀錄</Ext>
            <span className="muted"> · {f.id}</span>
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
  return (
    <Section title="決定" count={sorted.length}>
      {sorted.length === 0 ? (
        <p className="muted">還沒有記錄任何決定</p>
      ) : (
        <ul className="list card">
          {sorted.map((d) => (
            <DecisionItem key={d.frontmatter.id} d={d} board={board} />
          ))}
        </ul>
      )}
    </Section>
  );
}
