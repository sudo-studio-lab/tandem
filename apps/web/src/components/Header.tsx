import { useState, type FormEvent } from "react";
import { PRODUCT, type BoardData } from "@tandem/contracts";
import type { InviteResult } from "../useBoard.ts";
import { relTime } from "../time.ts";

interface Props {
  board: BoardData;
  now: number;
  mock: boolean;
  connected: boolean;
  refreshing: boolean;
  syncing: boolean;
  onRefresh: () => void;
  onSync: () => void;
  onInvite: (login: string) => Promise<InviteResult>;
}

function SyncIndicator({ board, now, syncing, onSync }: Pick<Props, "board" | "now" | "syncing" | "onSync">) {
  const s = board.sync;
  const retry = (
    <button type="button" className="btn btn-small" onClick={onSync} disabled={syncing}>
      重試同步
    </button>
  );
  switch (s.state) {
    case "syncing":
      return <span className="pill pill-info">同步中…</span>;
    case "idle":
      return <span className="pill pill-ok">已同步{s.lastSyncAt ? ` ${relTime(s.lastSyncAt, now)}` : ""}</span>;
    case "offline":
      return <span className="pill pill-warn">離線</span>;
    case "conflict":
      return (
        <span className="sync-problem">
          <span className="pill pill-bad">有衝突需要處理</span>
          {retry}
        </span>
      );
    case "error":
      return (
        <span className="sync-problem">
          <span className="pill pill-bad">同步錯誤{s.message ? `：${s.message}` : ""}</span>
          {retry}
        </span>
      );
  }
}

function InviteForm({ onInvite }: { onInvite: Props["onInvite"] }) {
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = login.trim().replace(/^@/, "");
    if (!name) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setResult(await onInvite(name));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("無法自動複製，請手動選取文字");
    }
  }

  return (
    <div className="invite card">
      <form onSubmit={submit} className="invite-form">
        <label htmlFor="invite-login">GitHub 帳號</label>
        <input
          id="invite-login"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="例如 octocat"
          autoComplete="off"
          spellCheck={false}
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
        <div className="share">
          <p>
            {result.status === "already" ? `@${result.invited} 已經是成員` : `已邀請 @${result.invited}`}
            。把下面這段話傳給對方：
          </p>
          <textarea
            readOnly
            rows={3}
            value={result.shareText}
            aria-label="邀請訊息"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="btn" onClick={copy}>
            {copied ? "已複製" : "複製"}
          </button>
        </div>
      )}
    </div>
  );
}

export function Header(p: Props) {
  const [inviting, setInviting] = useState(false);
  const { owner, name, url } = p.board.repo;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <h1 className="brand">{PRODUCT.displayName}</h1>
        <a href={url} target="_blank" rel="noreferrer" className="repo">
          {owner}/{name}
        </a>
        <div className="spacer" />
        {p.mock && <span className="pill pill-warn">範例資料</span>}
        {!p.connected && (
          <span className="pill pill-warn" role="status">
            重新連線中
          </span>
        )}
        <SyncIndicator board={p.board} now={p.now} syncing={p.syncing} onSync={p.onSync} />
        <button type="button" className="btn" onClick={p.onRefresh} disabled={p.refreshing}>
          {p.refreshing ? "更新中…" : "重新整理"}
        </button>
        <button type="button" className="btn" aria-expanded={inviting} onClick={() => setInviting((v) => !v)}>
          邀請
        </button>
      </div>
      {inviting && (
        <div className="topbar-inner">
          <InviteForm onInvite={p.onInvite} />
        </div>
      )}
    </header>
  );
}
