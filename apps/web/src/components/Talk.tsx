import type { DiscussionSummary, ProjectBoard } from "@tandem/contracts";
import type { Collab } from "../collab.ts";
import { relTime } from "../time.ts";
import { Ext } from "./Ext.tsx";
import { Group } from "./Group.tsx";
import { Glyph } from "./icons.tsx";
import { Avatar, Spinner } from "./ui.tsx";

/*
 * The 對話 tab: every place people (and their agents) talk, in one list. What needs your answer
 * first, then what is going on, then what has ended (folded). The right side of each row says
 * which kind it is: a room, a question or disagreement on GitHub, a question between agents, or a
 * chat someone shared.
 */

const KIND: Record<DiscussionSummary["kind"], string> = { question: "問題", disagreement: "意見不同", other: "討論" };

interface TalkRow {
  key: string;
  title: string;
  kind: string;
  /** Kinds that need care (a disagreement) read in the warning colour. */
  hard?: boolean;
  at: string;
  who: string;
  href?: string;
  open?: () => void;
}

const newest = (a: TalkRow, b: TalkRow) => Date.parse(b.at) - Date.parse(a.at);

function Row({ r, now }: { r: TalkRow; now: number }) {
  return (
    <li className="tb-row" title={`${r.title}\n${r.kind}・@${r.who}・${relTime(r.at, now)}`}>
      {r.href ? (
        <Ext href={r.href} className="tb-title">
          {r.title}
        </Ext>
      ) : (
        <button type="button" className="tb-title tk-open" onClick={r.open}>
          {r.title}
        </button>
      )}
      <span className="tb-meta">
        <span className={r.hard ? "lg-hard" : "tb-kind"}>{r.kind}</span>
        <Avatar login={r.who} size={16} />
        <span>{relTime(r.at, now)}</span>
      </span>
    </li>
  );
}

/** Questions on GitHub that name you on their first line (`等：@you`) and are still open. */
export function talkWaits(board: ProjectBoard): DiscussionSummary[] {
  const me = board.me.toLowerCase();
  return board.discussions.filter((d) => !d.closed && d.waitingOn.some((l) => l.toLowerCase() === me));
}

export function TalkTab(props: {
  board: ProjectBoard;
  collab: Collab;
  now: number;
  onOpenRoom: (n: number) => void;
  onNewRoom: () => void;
  onOpenAgentMessages: () => void;
  onOpenShared: (owner: string, id: string) => void;
}) {
  const { board, collab, now } = props;
  const mineSet = new Set(talkWaits(board).map((d) => d.id));
  const discussion = (d: DiscussionSummary): TalkRow => ({ key: `d${d.id}`, title: d.title, kind: KIND[d.kind], hard: d.kind === "disagreement", at: d.updatedAt, who: d.author, href: d.url });

  const mine = board.discussions.filter((d) => mineSet.has(d.id)).map(discussion).sort(newest);
  const live: TalkRow[] = [];
  const ended: TalkRow[] = [];
  for (const d of board.discussions) if (!mineSet.has(d.id)) (d.closed ? ended : live).push(discussion(d));
  for (const r of collab.rooms ?? []) {
    (r.closed ? ended : live).push({ key: `r${r.number}`, title: r.title, kind: "房間", at: r.updatedAt, who: r.host, open: () => props.onOpenRoom(r.number) });
  }
  for (const m of collab.agent?.messages ?? []) {
    if (m.archived) continue;
    const row: TalkRow = {
      key: `a${m.request.id}`,
      title: m.request.text.split("\n")[0]!.slice(0, 120),
      kind: "Agent 問答",
      at: m.reply?.at ?? m.request.at,
      who: m.request.from,
      open: props.onOpenAgentMessages,
    };
    (m.reply || m.stopped ? ended : live).push(row);
  }
  for (const c of collab.shared?.chats ?? []) {
    live.push({ key: `s${c.owner}/${c.id}`, title: c.title, kind: "分享的對話", at: c.sharedAt, who: c.owner, open: () => props.onOpenShared(c.owner, c.id) });
  }
  live.sort(newest);
  ended.sort(newest);

  const loading = collab.rooms === null;
  const nothing = !loading && mine.length + live.length + ended.length === 0;

  return (
    <div className="tb">
      {collab.error && (
        <p className="board-error" role="alert">
          <span className="status-dot" aria-hidden="true" />
          <span className="board-error-text">有些對話沒有載入：{collab.error}</span>
          <button type="button" className="tb-link" onClick={() => void collab.reload()}>
            再試一次
          </button>
        </p>
      )}
      {mine.length > 0 && (
        <Group label="要你回的" count={mine.length} wait>
          {mine.map((r) => (
            <Row key={r.key} r={r} now={now} />
          ))}
        </Group>
      )}
      {nothing ? (
        <p className="tb-empty-note">
          還沒有對話。
          <button type="button" className="tb-link" onClick={props.onNewRoom}>
            開一個房間
          </button>
        </p>
      ) : (
        <Group label="進行中" count={live.length}>
          {live.map((r) => (
            <Row key={r.key} r={r} now={now} />
          ))}
        </Group>
      )}
      {loading && <Spinner label="載入房間和問答…" />}
      {!nothing && (
        <button type="button" className="ctl tk-new" onClick={props.onNewRoom}>
          <Glyph name="plus" />
          <span>開房間</span>
        </button>
      )}
      {ended.length > 0 && (
        <Group label="已結束" count={ended.length} open={false} dim>
          {ended.map((r) => (
            <Row key={r.key} r={r} now={now} />
          ))}
        </Group>
      )}
    </div>
  );
}
