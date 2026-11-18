import { useEffect, useState, type FormEvent } from "react";
import { api, projectPath } from "../api.ts";
import { Modal, Avatar, errMsg, useCopy } from "./ui.tsx";
import "./collaboration.css";

export function InviteDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ shareText: string; who: string; dataNote?: string } | null>(null);
  const { copied, failed, copy } = useCopy();
  const [members,setMembers]=useState<{me:string;members:{login:string;role:string}[];canManage:boolean;canLeave:boolean;url:string|null;dataRepo:string|null;separate:boolean}|null>(null);
  const [notice,setNotice]=useState("");
  const loadMembers=()=>api<NonNullable<typeof members>>("GET",projectPath(projectId,"/members")).then(setMembers).catch(e=>setErr(errMsg(e)));
  useEffect(()=>{void loadMembers();},[projectId]);
  const resetLink=async()=>{if(!confirm("產生新的加入連結並作廢舊連結？既有 GitHub 邀請與成員權限不會因此改變。"))return;setBusy(true);setErr(null);try{const r=await api<{url:string}>("POST",projectPath(projectId,"/share-link/reset"),{confirm:true});setMembers(m=>m?{...m,url:r.url}:m);setNotice("已產生新連結，舊連結不能再加入 Tandem。");}catch(e){setErr(errMsg(e));}finally{setBusy(false);}};
  const remove=async(who:string,self=false)=>{if(!confirm(`${self?"離開專案":"移除 @"+who}？會移除程式 repo${members?.dataRepo?` 與 ${members.dataRepo}`:""} 的直接存取權。組織或團隊授權仍需在 GitHub 管理。`))return;setBusy(true);setErr(null);try{const r=await api<{complete:boolean}>(self?"POST":"DELETE",projectPath(projectId,self?"/leave":`/members/${encodeURIComponent(who)}`),{confirm:true});if(!r.complete)setErr("部分存取權仍存在。可能來自組織／團隊授權，或其中一個 repo 操作失敗，請到 GitHub 確認後再試。");else if(self){onClose();return;}else setNotice(`已移除 @${who} 的專案存取權。`);await loadMembers();}catch(e){setErr(errMsg(e));}finally{setBusy(false);}};

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
      await loadMembers();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="邀請與成員" onClose={onClose}>
      {members?.canManage&&<form onSubmit={submit} className="row">
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
      </form>}
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
      {members&&<>
        <h3>專案成員</h3><ul className="co-member-list">{members.members.map(m=><li key={m.login}><Avatar login={m.login} size={28}/><div className="grow"><strong>@{m.login}</strong><span className="row-meta">{m.login===members.me?"你 · ":""}{m.role==="admin"?"管理者":"成員"}</span></div>{members.canManage&&m.login.toLowerCase()!==members.me.toLowerCase()&&<button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={()=>void remove(m.login)}>移除</button>}</li>)}</ul>
        {members.separate&&<section className="co-link-section"><h3>加入連結</h3><p className="muted small">對方仍需要 GitHub 邀請與資料 repo 的權限。連結只協助加入 Tandem，不會授予 repo 權限。</p>{members.url?<button type="button" className="btn" onClick={()=>copy(members.url!)}>{copied?"已複製":"複製加入連結"}</button>:<p className="muted small">這台電腦沒有保留目前連結。管理者可產生新連結。</p>}{members.canManage&&<button type="button" className="btn btn-quiet" disabled={busy} onClick={()=>void resetLink()}>產生新連結</button>}{failed&&<p role="alert">無法複製，請重新產生後再試。</p>}</section>}
        {notice&&<p role="status">{notice}</p>}
        {members.canLeave&&<div className="co-actions"><button type="button" className="btn btn-danger" disabled={busy} onClick={()=>void remove(members.me,true)}>離開這個專案</button></div>}
      </>}
    </Modal>
  );
}

/**
 * Desktop only: the address that puts this board in an editor's built-in browser. The key in it is
 * masked on screen; copy puts the whole address on the clipboard. Replacing it ends the old one.
 */
export function SidebarLink() {
  const bridge = window.tandemDesktop;
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    bridge?.getSidebarUrl?.().then(setUrl, () => setUrl(""));
  }, [bridge]);
  if (!bridge?.getSidebarUrl) return null;

  async function copy() {
    setErr(null);
    const ok = await bridge!.copySidebarUrl?.().catch(() => false);
    if (!ok) return setErr("沒有複製成功，再試一次。");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  async function replace() {
    setBusy(true);
    setErr(null);
    try {
      setUrl((await bridge!.replaceSidebarUrl?.()) ?? "");
      setConfirming(false);
      setCopied(false);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const shown = url ? url.replace(/\?t=.*$/, "?t=••••••") : "";
  return (
    <section className="sb-link" aria-label="放在編輯器側欄">
      <p className="muted small">把網址貼進編輯器的內建瀏覽器。App 重開或更新後不用重貼。</p>
      <div className="sb-url">
        <code className="mono" title={url ? "按「複製網址」取得完整網址" : undefined}>
          {url === null ? "讀取中…" : shown || "Tandem 還在啟動，稍後再打開設定"}
        </code>
        <button type="button" className="btn btn-small" disabled={!url} onClick={() => void copy()}>
          {copied ? "已複製" : "複製網址"}
        </button>
      </div>
      {confirming ? (
        <p className="sb-confirm" role="group" aria-label="換一個網址">
          <span>舊網址會立刻失效，貼過的地方要重貼。</span>
          <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => void replace()}>
            {busy ? "換新中…" : "換新網址"}
          </button>
          <button type="button" className="btn btn-small btn-quiet" disabled={busy} onClick={() => setConfirming(false)}>
            取消
          </button>
        </p>
      ) : (
        <button type="button" className="btn btn-small btn-quiet sb-replace" disabled={!url} onClick={() => setConfirming(true)}>
          換一個網址
        </button>
      )}
      {err && (
        <p className="banner banner-error" role="alert">
          {err}
        </p>
      )}
    </section>
  );
}
