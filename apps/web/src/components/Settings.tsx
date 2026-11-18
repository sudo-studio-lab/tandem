import { useEffect, useState } from "react";
import type { AppSession, AppSettings, NotificationKind, ProjectBoard } from "@tandem/contracts";
import { api } from "../api.ts";
import { errMsg } from "./ui.tsx";
import { PageBar } from "./PageBar.tsx";
import { Section } from "./Group.tsx";
import { SidebarLink } from "./Dialogs.tsx";
import { useAgents } from "./Chat.tsx";
import { AnswerSettings } from "./AgentMessages.tsx";
import { ShareSettings } from "./SharedChats.tsx";
import "./collaboration.css";
import "./co-panel.css";

const TOGGLES: { kind: NotificationKind; label: string }[] = [
  { kind: "waiting", label: "有人在等我" },
  { kind: "review", label: "有人請我審查" },
  { kind: "task", label: "有任務指派給我" },
];

/**
 * Every setting in one page: notifications, the side-panel address, which AI tools are signed in,
 * what your agent answers and which chats you share (this project), and your account.
 */
export function SettingsPage({ session, board, back, onBack, onOpenAgents, onSignOut }: { session: AppSession; board: ProjectBoard | null; back?: string; onBack: () => void; onOpenAgents: () => void; onSignOut: () => Promise<void> }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { agents } = useAgents();

  useEffect(() => {
    let stop = false;
    api<AppSettings>("GET", "/api/settings")
      .then(async (s) => {
        // The desktop app is the source of truth for auto-start.
        const bridge = window.tandemDesktop;
        if (bridge) {
          try {
            s = { ...s, openAtLogin: await bridge.getOpenAtLogin() };
          } catch {
            /* keep the server value */
          }
        }
        if (!stop) setSettings(s);
      })
      .catch((e) => !stop && setErr(errMsg(e)));
    return () => {
      stop = true;
    };
  }, []);

  async function save(next: AppSettings) {
    const prev = settings;
    setSettings(next);
    setErr(null);
    try {
      await api("PUT", "/api/settings", next);
    } catch (e) {
      setSettings(prev);
      setErr(errMsg(e));
    }
  }

  async function toggleLogin(v: boolean) {
    if (!settings) return;
    try {
      await window.tandemDesktop?.setOpenAtLogin(v);
    } catch (e) {
      setErr(errMsg(e));
      return;
    }
    await save({ ...settings, openAtLogin: v });
  }

  async function signOut() {
    setBusy(true);
    try {
      await onSignOut();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  }

  const signedIn = (agents ?? []).filter((a) => a.installed && a.auth !== "none" && a.auth !== "unknown").map((a) => a.label);
  return (
    <section className="co-page st" aria-labelledby="st-title">
      <PageBar back={back} title="設定" titleId="st-title" onBack={onBack} />
      {err && (
        <p className="banner banner-error" role="alert">
          {err}
        </p>
      )}
      <div className="tb">
        <Section label="通知" open>
          {!settings ? (
            <p className="muted">讀取中…</p>
          ) : (
            <ul className="toggles">
              {TOGGLES.map((t) => (
                <li key={t.kind}>
                  <label className="toggle">
                    <input type="checkbox" checked={settings.notifications[t.kind]} onChange={(e) => save({ ...settings, notifications: { ...settings.notifications, [t.kind]: e.target.checked } })} />
                    <span>{t.label}</span>
                  </label>
                </li>
              ))}
              {/* Only inside the desktop app: in a browser (e.g. the side panel) there is nothing to start at login. */}
              {session.desktop && window.tandemDesktop && (
                <li>
                  <label className="toggle">
                    <input type="checkbox" checked={settings.openAtLogin} onChange={(e) => toggleLogin(e.target.checked)} />
                    <span>開機時自動啟動</span>
                  </label>
                </li>
              )}
            </ul>
          )}
        </Section>
        {window.tandemDesktop?.getSidebarUrl && (
          <Section label="放在編輯器側欄" open>
            <SidebarLink />
          </Section>
        )}
        <Section label="AI 工具" end={agents ? `${signedIn.length} 個已登入` : ""} open>
          <p className="co-status-line">
            <span>{agents ? (signedIn.length ? `${signedIn.join("、")} 已登入。` : "還沒登入任何 AI。") : "檢查中…"}</span>
            <button type="button" className="tb-link" onClick={onOpenAgents}>
              管理登入
            </button>
          </p>
        </Section>
        {board && <AnswerSettings key={`a${board.projectId}`} projectId={board.projectId} />}
        {board && <ShareSettings key={`s${board.projectId}`} board={board} />}
        <Section label="帳號" open>
          <p className="muted small">
            已登入 @{session.login}・Tandem {session.version}
          </p>
          <button type="button" className="btn" onClick={signOut} disabled={busy}>
            {busy ? "登出中…" : "登出"}
          </button>
        </Section>
      </div>
    </section>
  );
}
