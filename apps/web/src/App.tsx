import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { useApp } from "./useApp.ts";
import { useNow } from "./time.ts";
import { Header, type View } from "./components/Header.tsx";
import { TaskBoard } from "./components/TaskBoard.tsx";
import { Waiting } from "./components/Waiting.tsx";
import { Discussions } from "./components/Discussions.tsx";
import { Decisions } from "./components/Decisions.tsx";
import { Problems } from "./components/Problems.tsx";
import { SignIn } from "./components/SignIn.tsx";
import { Picker, type StartOp } from "./components/Picker.tsx";
import { ProgressView } from "./components/Progress.tsx";
import { InviteDialog, SettingsDialog } from "./components/Dialogs.tsx";
import { AgentSettingsDialog, ChatView } from "./components/Chat.tsx";
import { RoomView } from "./components/Room.tsx";
import { ContextPage } from "./components/Context.tsx";
import { AgentMessagesPage } from "./components/AgentMessages.tsx";
import { SharedChatsPage } from "./components/SharedChats.tsx";
import { Spinner, errMsg } from "./components/ui.tsx";

interface Op {
  /** null while the start request is in flight. */
  opId: string | null;
  withAccept: boolean;
  start: () => Promise<{ opId: string }>;
}

const joinHint = () => new URLSearchParams(location.search).get("join");

export function App() {
  const app = useApp();
  const { session, board, progress } = app;
  const now = useNow();
  const [showPicker, setShowPicker] = useState(false);
  const [op, setOp] = useState<Op | null>(null);
  const [dialog, setDialog] = useState<"invite" | "settings" | "agents" | null>(null);
  const [view, setView] = useState<View>("board");
  const [boardTab, setBoardTab] = useState<"list" | "log" | "context" | "agent-messages" | "shared-chats">("list");
  const [forkId,setForkId]=useState<string|undefined>();
  const [toast, setToast] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const handledDone = useRef<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 7000);
  }, []);

  // Desktop bridge: badge = everything waiting across all projects.
  const attention = session ? session.projects.reduce((n, p) => n + p.attention, 0) : 0;
  useEffect(() => {
    window.tandemDesktop?.setBadge(attention);
    document.title = attention > 0 ? `(${attention}) Tandem` : "Tandem";
  }, [attention]);

  // Start an operation (accept / start / new) and follow it in the progress view.
  const begin: StartOp = useCallback(
    (start, withAccept) => {
      setStartError(null);
      const next: Op = { opId: null, withAccept, start };
      setOp(next);
      start().then(
        (r) => setOp((cur) => (cur === next ? { ...next, opId: r.opId } : cur)),
        (e) => {
          setOp(null);
          setStartError(errMsg(e));
        },
      );
    },
    [],
  );

  const retry = () => {
    if (op) begin(op.start, op.withAccept);
  };

  // When the operation is done, show that project.
  const p = op?.opId ? progress[op.opId] : undefined;
  useEffect(() => {
    if (!op?.opId || !p || p.step !== "done" || p.error || !p.projectId) return;
    if (handledDone.current === op.opId) return;
    handledDone.current = op.opId;
    void app.selectProject(p.projectId).then(() => {
      setOp(null);
      setShowPicker(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op?.opId, p]);

  const openFolder = async (path: string) => {
    const r = await api<{ id?: string } | undefined>("POST", "/api/projects/open-folder", { path });
    if (r?.id) await app.selectProject(r.id);
    else await app.loadSession();
    setShowPicker(false);
  };

  const signOut = async () => {
    await api("POST", "/api/logout");
    setDialog(null);
    setShowPicker(false);
    await app.loadSession();
  };

  if (session === undefined) {
    return (
      <main className="center-page">
        <div className="panel">
          <h1 className="brand-big">Tandem</h1>
          {app.loadError ? (
            <>
              <p className="banner banner-error" role="alert">
                {app.loadError}
              </p>
              <button type="button" className="btn btn-primary" onClick={() => void app.loadSession()}>
                再試一次
              </button>
            </>
          ) : (
            <Spinner label="載入中…" />
          )}
        </div>
      </main>
    );
  }

  if (!session.login) return <SignIn onSignedIn={() => void app.loadSession()} />;

  if (op) {
    return (
      <ProgressView
        progress={p}
        withAccept={op.withAccept}
        onRetry={retry}
        onBack={() => {
          setOp(null);
          setShowPicker(true);
        }}
      />
    );
  }

  const project = session.projects.find((x) => x.id === session.currentProjectId);
  const picking = showPicker || session.projects.length === 0 || !project;

  const toastEl = toast && (
    <p className="banner banner-error toast" role="alert">
      {toast}{" "}
      <button type="button" className="btn btn-small" onClick={() => setToast(null)}>
        知道了
      </button>
    </p>
  );

  const header = (
    <Header
      session={session}
      project={project}
      board={board}
      now={now}
      mock={app.mock}
      connected={app.connected}
      refreshing={app.refreshing}
      syncing={app.syncing}
      onRefresh={app.refresh}
      onSync={app.sync}
      onSelect={(id) => {
        setShowPicker(false);
        setForkId(undefined);
        void app.selectProject(id);
      }}
      onRemove={app.removeProject}
      onAddProject={() => setShowPicker(true)}
      onInvite={() => setDialog("invite")}
      onSettings={() => setDialog("settings")}
      onError={notify}
      view={view}
      onView={(v) => {
        setView(v);
        if (v === "board") setBoardTab("list");
      }}
      onLog={() => {
        setView("board");
        setBoardTab("log");
      }}
      onContext={() => {
        setView("board");
        setBoardTab("context");
      }}
      onAgentMessages={()=>{setView("board");setBoardTab("agent-messages");}}
      onSharedChats={()=>{setView("board");setBoardTab("shared-chats");}}
      onRooms={() => setView("room")}
    />
  );

  return (
    <>
      {header}
      {toastEl}
      {startError && (
        <p className="banner banner-error toast" role="alert">
          {startError}
        </p>
      )}
      {picking ? (
        <Picker
          session={session}
          hint={joinHint()}
          now={now}
          onStart={begin}
          onOpenFolder={openFolder}
          onBack={project ? () => setShowPicker(false) : undefined}
        />
      ) : !project.available ? (
        <main className="page">
          <div className="card pad gap-top">
            <h2>找不到資料夾</h2>
            <p className="muted">{project.path} 不見了，可能被移動或刪除。你可以把它從清單移除，再重新加入專案。</p>
            <button type="button" className="btn btn-primary" onClick={() => void app.removeProject(project.id).catch((e) => notify(errMsg(e)))}>
              從清單移除
            </button>
          </div>
        </main>
      ) : view === "room" ? (
        <RoomView
          key={project.id}
          projectId={project.id}
          me={session.login}
          now={now}
          onOpenSettings={() => setDialog("agents")}
          onBack={() => {
            setView("board");
            setBoardTab("list");
          }}
        />
      ) : view === "chat" ? (
        <><div className="page tb-back"><button type="button" className="tb-link" onClick={()=>{setView("board");setBoardTab("shared-chats");}}>回對話與交接</button></div><ChatView key={project.id} projectId={project.id} now={now} initialChatId={forkId} onOpenSettings={() => setDialog("agents")} /></>
      ) : !board ? (
        <main className="page">
          {app.boardError ? (
            <p className="banner banner-error" role="alert">
              無法載入看板：{app.boardError}{" "}
              <button type="button" className="btn btn-small" onClick={() => void app.refresh()}>
                再試一次
              </button>
            </p>
          ) : (
            <Spinner label="載入看板中…" />
          )}
        </main>
      ) : (
        <main className="page board">
          {app.boardError && (
            <p className="board-error" role="alert">
              <span className="status-dot" aria-hidden="true" />
              <span className="board-error-text">看板沒有更新：{app.boardError}</span>
              <button type="button" className="tb-link" onClick={() => void app.reloadBoard()}>
                再試一次
              </button>
            </p>
          )}
          {boardTab === "list" ? (
            <TaskBoard key={project.id} board={board} now={now} onTaskCreated={app.reloadBoard} />
          ) : boardTab === "context" ? (
            <ContextPage key={project.id} projectId={project.id} now={now} onBack={() => setBoardTab("list")} />
          ) : boardTab === "agent-messages" ? (
            <AgentMessagesPage key={project.id} projectId={project.id} me={session.login} now={now} onBack={()=>setBoardTab("list")} />
          ) : boardTab === "shared-chats" ? (
            <SharedChatsPage key={project.id} board={board} now={now} onBack={()=>setBoardTab("list")} onChanged={app.reloadBoard} onFork={id=>{setForkId(id);setView("chat");}}/>
          ) : (
            <div className="tb-log">
              <p className="tb-back">
                <button type="button" className="tb-link" onClick={() => setBoardTab("list")}>
                  ← 回任務
                </button>
              </p>
              <Waiting items={board.waiting} now={now} />
              <Decisions board={board} />
              <Discussions items={board.discussions} now={now} />
            </div>
          )}
          <Problems items={board.problems} />
        </main>
      )}
      {dialog === "invite" && project && <InviteDialog projectId={project.id} onClose={() => setDialog(null)} />}
      {dialog === "agents" && <AgentSettingsDialog onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog session={session} onClose={() => setDialog(null)} onSignOut={signOut} />}
    </>
  );
}
