import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { useApp } from "./useApp.ts";
import { useNow } from "./time.ts";
import { Header } from "./components/Header.tsx";
import { TaskBoard, taskWaits } from "./components/TaskBoard.tsx";
import { Teammates, blockedTeammates } from "./components/People.tsx";
import { BoardTabs, TAB_LABEL, TAB_PANEL, tabId, type BoardTab } from "./components/Tabs.tsx";
import { TalkTab, talkWaits } from "./components/Talk.tsx";
import { Decisions } from "./components/Decisions.tsx";
import { Problems } from "./components/Problems.tsx";
import { SignIn } from "./components/SignIn.tsx";
import { Picker, type StartOp } from "./components/Picker.tsx";
import { ProgressView } from "./components/Progress.tsx";
import { InviteDialog } from "./components/Dialogs.tsx";
import { SettingsPage } from "./components/Settings.tsx";
import { AgentSettingsDialog, ChatView } from "./components/Chat.tsx";
import { RoomView } from "./components/Room.tsx";
import { ContextGroup, ContextPage } from "./components/Context.tsx";
import { AgentMessagesPage } from "./components/AgentMessages.tsx";
import { HandoffPage, SharedChatPage } from "./components/SharedChats.tsx";
import { Spinner, errMsg } from "./components/ui.tsx";
import { HOME, PageBar } from "./components/PageBar.tsx";
import { handoffsToMe, useCollab } from "./collab.ts";

interface Op {
  /** null while the start request is in flight. */
  opId: string | null;
  withAccept: boolean;
  start: () => Promise<{ opId: string }>;
}

const joinHint = () => new URLSearchParams(location.search).get("join");

/** A page opened from a tab (or the settings button), shown instead of the tabs until its back link is used. */
type Page =
  | { kind: "room"; room: number | "new" }
  | { kind: "agent-messages" }
  | { kind: "shared-chat"; owner: string; id: string }
  | { kind: "chat"; forkId: string }
  | { kind: "handoff"; task: { number: number; title: string } }
  | { kind: "context"; file?: string; create?: string }
  | { kind: "settings" };

export function App() {
  const app = useApp();
  const { session, board, progress } = app;
  const now = useNow();
  const [showPicker, setShowPicker] = useState(false);
  const [op, setOp] = useState<Op | null>(null);
  const [dialog, setDialog] = useState<"invite" | "agents" | null>(null);
  const [tab, setTab] = useState<BoardTab>("tasks");
  /** A decision opened from a teammate's note: the 決定 tab opens it and scrolls to it. */
  const [focusDecision, setFocusDecision] = useState<string | undefined>();
  const [page, setPage] = useState<Page | null>(null);
  /** Set when a page's back link is used, so focus lands on the tab it returned to. */
  const returning = useRef(false);
  const backToTabs = () => {
    returning.current = true;
    setPage(null);
  };
  useEffect(() => {
    if (!returning.current || page !== null) return;
    returning.current = false;
    document.getElementById(tabId(tab))?.focus();
  });
  const collab = useCollab(session?.login ? (session.currentProjectId ?? undefined) : undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const handledDone = useRef<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 7000);
  }, []);
  const tell = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((t) => (t === msg ? null : t)), 7000);
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
    setPage(null);
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

  const toastEl = toast ? (
    <p className="banner banner-error toast" role="alert">
      {toast}{" "}
      <button type="button" className="btn btn-small" onClick={() => setToast(null)}>
        知道了
      </button>
    </p>
  ) : (
    notice && (
      <p className="banner toast" role="status">
        {notice}{" "}
        <button type="button" className="btn btn-small" onClick={() => setNotice(null)}>
          知道了
        </button>
      </p>
    )
  );
  const back = TAB_LABEL[tab];
  const me = session.login;

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
        setPage(null);
        setFocusDecision(undefined);
        void app.selectProject(id);
      }}
      onRemove={app.removeProject}
      onAddProject={() => {
        setPage(null);
        setShowPicker(true);
      }}
      onInvite={() => setDialog("invite")}
      onSettings={() => setPage({ kind: "settings" })}
      onError={notify}
      view="board"
      onView={() => setPage(null)}
    />
  );
  const openTab = (t: BoardTab) => {
    setTab(t);
    setFocusDecision(undefined);
  };

  return (
    <>
      {header}
      {toastEl}
      {startError && (
        <p className="banner banner-error toast" role="alert">
          {startError}
        </p>
      )}
      {page?.kind === "settings" ? (
        <main className="page board">
          <SettingsPage session={session} board={!picking && project.available ? board : null} back={picking ? "專案" : back} onBack={backToTabs} onOpenAgents={() => setDialog("agents")} onSignOut={signOut} />
        </main>
      ) : picking ? (
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
      ) : page?.kind === "room" ? (
        <RoomView
          key={`${project.id}:${page.room}`}
          projectId={project.id}
          me={me}
          now={now}
          room={page.room}
          back={back}
          onOpenSettings={() => setDialog("agents")}
          onBack={backToTabs}
          onChanged={() => void collab.reload()}
        />
      ) : page?.kind === "chat" ? (
        <>
          <div className="page">
            <PageBar back={back} title="接續對話" onBack={backToTabs} />
          </div>
          <ChatView key={project.id} projectId={project.id} now={now} initialChatId={page.forkId} onOpenSettings={() => setDialog("agents")} />
        </>
      ) : !board ? (
        <main className="page">
          {app.boardError ? (
            <p className="banner banner-error" role="alert">
              無法載入{HOME}：{app.boardError}{" "}
              <button type="button" className="btn btn-small" onClick={() => void app.refresh()}>
                再試一次
              </button>
            </p>
          ) : (
            <Spinner label={`載入${HOME}中…`} />
          )}
        </main>
      ) : (
        <main className="page board">
          {page?.kind === "context" ? (
            <ContextPage key={`${project.id}:${page.file ?? ""}:${page.create ?? ""}`} projectId={project.id} now={now} back={back} file={page.file} create={page.create} onBack={backToTabs} />
          ) : page?.kind === "agent-messages" ? (
            <AgentMessagesPage key={project.id} projectId={project.id} me={me} now={now} back={back} onBack={backToTabs} onOpenSettings={() => setPage({ kind: "settings" })} />
          ) : page?.kind === "shared-chat" ? (
            <SharedChatPage key={`${project.id}:${page.owner}/${page.id}`} board={board} owner={page.owner} chatId={page.id} back={back} onBack={backToTabs} onFork={(forkId) => setPage({ kind: "chat", forkId })} />
          ) : page?.kind === "handoff" ? (
            <HandoffPage
              key={`${project.id}:${page.task.number}`}
              board={board}
              task={page.task}
              now={now}
              back={back}
              onBack={backToTabs}
              onDone={async (msg) => {
                backToTabs();
                tell(msg);
                await Promise.all([app.reloadBoard(), collab.reload()]);
              }}
            />
          ) : (
            <>
              <BoardTabs
                tab={tab}
                counts={{ tasks: taskWaits(board).length + handoffsToMe(collab.shared, me, now).length, talk: talkWaits(board).length }}
                stuck={blockedTeammates(board)}
                onTab={openTab}
              />
              {/* Under the tabs, so the tabs stay put when this line comes and goes. */}
              {app.boardError && (
                <p className="board-error" role="alert">
                  <span className="status-dot" aria-hidden="true" />
                  <span className="board-error-text">資料沒有更新：{app.boardError}</span>
                  <button type="button" className="tb-link" onClick={() => void app.reloadBoard()}>
                    再試一次
                  </button>
                </p>
              )}
              <div role="tabpanel" id={TAB_PANEL} aria-labelledby={tabId(tab)} className="bt-panel">
                {tab === "tasks" ? (
                  <TaskBoard key={project.id} board={board} now={now} handoffs={handoffsToMe(collab.shared, me, now)} onHandoff={(it) => setPage({ kind: "handoff", task: { number: it.number, title: it.title } })} />
                ) : tab === "talk" ? (
                  <TalkTab
                    board={board}
                    collab={collab}
                    now={now}
                    onOpenRoom={(n) => setPage({ kind: "room", room: n })}
                    onNewRoom={() => setPage({ kind: "room", room: "new" })}
                    onOpenAgentMessages={() => setPage({ kind: "agent-messages" })}
                    onOpenShared={(owner, id) => setPage({ kind: "shared-chat", owner, id })}
                  />
                ) : tab === "people" ? (
                  <Teammates
                    board={board}
                    now={now}
                    onInvite={() => setDialog("invite")}
                    onShowTasks={() => openTab("tasks")}
                    onOpenDecision={(id) => {
                      setTab("decisions");
                      setFocusDecision(id);
                    }}
                    onOpenRoom={(n) => setPage({ kind: "room", room: n })}
                  />
                ) : (
                  <div className="tb">
                    <Decisions board={board} focus={focusDecision} />
                    <ContextGroup
                      key={project.id}
                      projectId={project.id}
                      now={now}
                      onOpen={(file) => setPage({ kind: "context", file })}
                      onNew={(create) => setPage({ kind: "context", create })}
                    />
                  </div>
                )}
                <Problems items={board.problems} />
              </div>
            </>
          )}
        </main>
      )}
      {dialog === "invite" && project && <InviteDialog projectId={project.id} onClose={() => setDialog(null)} />}
      {dialog === "agents" && <AgentSettingsDialog onClose={() => setDialog(null)} />}
    </>
  );
}
