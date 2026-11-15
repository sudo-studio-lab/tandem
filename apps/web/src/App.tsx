import { PRODUCT } from "@tandem/contracts";
import { useBoard } from "./useBoard.ts";
import { useNow } from "./time.ts";
import { Header } from "./components/Header.tsx";
import { People } from "./components/People.tsx";
import { Waiting } from "./components/Waiting.tsx";
import { Discussions } from "./components/Discussions.tsx";
import { Tasks } from "./components/Tasks.tsx";
import { Decisions } from "./components/Decisions.tsx";
import { Problems } from "./components/Problems.tsx";

export function App() {
  const { board, error, connected, mock, refreshing, syncing, refresh, sync, invite } = useBoard();
  const now = useNow();

  if (!board) {
    return (
      <main className="page">
        <h1>{PRODUCT.displayName}</h1>
        {error ? (
          <p className="banner banner-error" role="alert">
            無法載入看板：{error}
          </p>
        ) : (
          <p className="muted">載入中…</p>
        )}
      </main>
    );
  }

  return (
    <>
      <Header
        board={board}
        now={now}
        mock={mock}
        connected={connected}
        refreshing={refreshing}
        syncing={syncing}
        onRefresh={refresh}
        onSync={sync}
        onInvite={invite}
      />
      <main className="page">
        {error && (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        )}
        <People board={board} now={now} />
        <Waiting items={board.waiting} now={now} />
        <Discussions items={board.discussions} now={now} />
        <Tasks items={board.tasks} />
        <Decisions board={board} />
        <Problems items={board.problems} />
      </main>
    </>
  );
}
