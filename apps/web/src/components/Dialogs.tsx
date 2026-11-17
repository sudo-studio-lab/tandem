import { useEffect, useState, type FormEvent } from "react";
import type { AppSession, AppSettings, NotificationKind } from "@tandem/contracts";
import { api, projectPath } from "../api.ts";
import { Modal, errMsg, useCopy } from "./ui.tsx";

export function InviteDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ shareText: string; who: string; dataNote?: string } | null>(null);
  const { copied, failed, copy } = useCopy();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const who = login.trim().replace(/^@/, "");
    if (!who) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api<{ shareText: string; url: string; dataRepo?: { repo: string; error?: string } }>(
        "POST",
        projectPath(projectId, "/invite"),
        { login: who },
      );
      // Team data in a separate repo: the invite covers both, but say so when that half failed.
      setResult({ shareText: r.shareText, who, dataNote: r.dataRepo?.error });
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="邀請隊友" onClose={onClose}>
      <form onSubmit={submit} className="row">
        <label htmlFor="invite-login" className="sr-only">
          對方的 GitHub 帳號
        </label>
        <input
          id="invite-login"
          className="input grow"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="對方的 GitHub 帳號，例如 octocat"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !login.trim()}>
          {busy ? "邀請中…" : "邀請"}
        </button>
      </form>
      {err && (
        <p className="banner banner-error" role="alert">
          {err}
        </p>
      )}
      {result && (
        <div className="gap-top">
          <p>已邀請 @{result.who}。把下面這段話傳給對方：</p>
          {result.dataNote && (
            <p className="banner banner-error" role="alert">
              {result.dataNote}
            </p>
          )}
          <label htmlFor="share-text" className="sr-only">
            邀請訊息
          </label>
          <textarea id="share-text" className="input full" readOnly rows={5} value={result.shareText} onFocus={(e) => e.currentTarget.select()} />
          <div className="row gap-top">
            <button type="button" className="btn btn-primary" onClick={() => copy(result.shareText)}>
              {copied ? "已複製" : "複製"}
            </button>
            {failed && <span className="muted small">無法自動複製，請手動選取文字</span>}
          </div>
        </div>
      )}
      <p className="muted small gap-top">對方下載 Tandem、用 GitHub 登入後就會看到邀請</p>
    </Modal>
  );
}

const TOGGLES: { kind: NotificationKind; label: string; help: string }[] = [
  { kind: "waiting", label: "有人在等我", help: "別人在等你回答或決定時" },
  { kind: "review", label: "有人請我審查", help: "有人請你看一份修改時" },
  { kind: "task", label: "有任務指派給我", help: "有新任務交給你時" },
];

export function SettingsDialog({ session, onClose, onSignOut }: { session: AppSession; onClose: () => void; onSignOut: () => Promise<void> }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <Modal title="設定" onClose={onClose}>
      <h3 className="sub">通知</h3>
      {!settings ? (
        <p className="muted">{err ? "" : "讀取中…"}</p>
      ) : (
        <ul className="toggles">
          {TOGGLES.map((t) => (
            <li key={t.kind}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.notifications[t.kind]}
                  onChange={(e) => save({ ...settings, notifications: { ...settings.notifications, [t.kind]: e.target.checked } })}
                />
                <span>
                  {t.label}
                  <span className="muted small block">{t.help}</span>
                </span>
              </label>
            </li>
          ))}
          {session.desktop && (
            <li>
              <label className="toggle">
                <input type="checkbox" checked={settings.openAtLogin} onChange={(e) => toggleLogin(e.target.checked)} />
                <span>
                  開機時自動啟動
                  <span className="muted small block">開機後 Tandem 會在背景待命，有人在等你時通知你</span>
                </span>
              </label>
            </li>
          )}
        </ul>
      )}
      {err && (
        <p className="banner banner-error" role="alert">
          {err}
        </p>
      )}
      <hr />
      <p className="muted small">
        已登入：@{session.login} · Tandem 版本 {session.version}
      </p>
      <button type="button" className="btn" onClick={signOut} disabled={busy}>
        {busy ? "登出中…" : "登出"}
      </button>
    </Modal>
  );
}
