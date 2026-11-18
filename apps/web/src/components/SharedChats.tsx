import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AgentStatus, Handoff, ProjectBoard, ProjectTranscript, SharedChat, SharedChatSettings } from "@tandem/contracts";
import { api, projectPath } from "../api.ts";
import { errMsg, Spinner, useCopy } from "./ui.tsx";
import { relTime } from "../time.ts";
import { TranscriptChoices } from "./AgentMessages.tsx";
import { PageBar } from "./PageBar.tsx";
import "./collaboration.css";
import "./co-panel.css";

interface Data{settings:SharedChatSettings;chats:SharedChat[];handoffs:Handoff[]}
export function SharedChatsPage({board,now,onBack,onFork,onChanged}:{board:ProjectBoard;now:number;onBack:()=>void;onFork:(id:string)=>void;onChanged:()=>void|Promise<void>}){
  const id=board.projectId;const [data,setData]=useState<Data|null>(null);const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
  const [choices,setChoices]=useState<ProjectTranscript[]|null>(null);const [selected,setSelected]=useState<string[]>([]);const [preview,setPreview]=useState<{token:string;transcripts:ProjectTranscript[]}|null>(null);
  const [reading,setReading]=useState<string|null>(null);const [agents,setAgents]=useState<AgentStatus[]>([]);const [provider,setProvider]=useState<"claude"|"codex">("codex");const [model,setModel]=useState("");
  const [task,setTask]=useState("");const [to,setTo]=useState("");const [note,setNote]=useState("");const {copy,copied,failed}=useCopy();
  const load=useCallback(async()=>{try{setData(await api<Data>("GET",projectPath(id,"/shared-chats")));setError(null);}catch(e){setError(errMsg(e));}},[id]);
  useEffect(()=>{void load();const t=setInterval(()=>void load(),15000);void api<AgentStatus[]>("GET","/api/agents").then(setAgents).catch(()=>undefined);return()=>clearInterval(t);},[load]);
  const choose=async()=>{setBusy(true);try{setChoices(await api<ProjectTranscript[]>("GET",projectPath(id,"/local-transcripts")));setSelected(data?.settings.transcriptIds??[]);setPreview(null);}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  const prepare=async()=>{setBusy(true);try{setPreview(await api("POST",projectPath(id,"/shared-chats/preview"),{ids:selected}));setError(null);}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  const publish=async()=>{if(!preview)return;setBusy(true);try{await api("POST",projectPath(id,"/shared-chats/confirm"),{token:preview.token});setPreview(null);setChoices(null);setNotice("已分享選取的對話。之後的新內容會持續同步，你隨時可以關閉。");await load();}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  const stop=async()=>{if(!confirm("關閉分享並撤回目前可見的對話？私人資料 repo 的 Git 歷史仍會保留舊版本。"))return;setBusy(true);try{const r=await api<{write:{result:string}}>("POST",projectPath(id,"/shared-chats/stop"));setNotice(r.write.result==="pushed"?"已停止同步，並撤回目前分享。":"已停止本機同步；撤回正在等待連線，隊友可能仍看得到舊版本。");await load();}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  const chat=data?.chats.find(c=>`${c.owner}/${c.id}`===reading);
  const fork=async()=>{if(!chat)return;setBusy(true);try{const r=await api<{id:string}>("POST",projectPath(id,"/shared-chats/fork"),{owner:chat.owner,id:chat.id,provider,model});onFork(r.id);}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  const handoff=async(e:FormEvent)=>{e.preventDefault();if(!confirm(`把任務 #${task} 改指派給 @${to}，並送出這份交接筆記？`))return;setBusy(true);try{const r=await api<{write:{result:string}}>("POST",projectPath(id,"/handoffs"),{task:Number(task),to,note,confirm:true});setNote("");setNotice(r.write.result==="pushed"?"已完成交接，接手人的開工報告會看到筆記。":"任務已改指派，交接筆記等待同步。");await load();await onChanged();}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  return <section className="co-page" aria-labelledby="co-shared-title"><PageBar title="對話與交接" titleId="co-shared-title" onBack={onBack} />
    <p className="muted co-lead">分享自己選定的專案對話，或把目前的工作清楚交給隊友。</p>
    {error&&<p className="banner banner-error" role="alert">{error} <button type="button" className="btn btn-small" onClick={()=>void load()}>重新載入</button></p>}
    {notice&&<p role="status" className="banner">{notice}</p>}
    {!data&&!error&&<Spinner label="載入分享中…"/>}
    {data&&<>
      <details className="co-settings"><summary>我的對話分享 <span className="pill">{data.settings.enabled?"同步中":"關閉"}</span></summary>
        <p>只分享你選定的這個專案對話。預覽列出的使用者與 AI 文字會送到私人團隊資料 repo，確認後也會同步這幾段的新內容；附件、工具輸出和更早的內容不分享。</p>
        <p className="row-meta">每段最多最近 100 則文字，單則最多 24000 字、總計最多 512 KB。關閉分享可撤回目前版本，Git 歷史仍保留。</p>
        {data.settings.lastError&&<p className="banner banner-error" role="alert">{data.settings.lastError}</p>}
        <div className="co-actions"><button type="button" className="btn" disabled={busy} onClick={()=>void choose()}>挑選要分享的對話</button>{(data.settings.enabled||data.chats.some(c=>c.owner.toLowerCase()===board.me.toLowerCase()))&&<button type="button" className="btn btn-danger" disabled={busy} onClick={()=>void stop()}>關閉並撤回分享</button>}</div>
        {choices&&!preview&&<><TranscriptChoices items={choices} selected={selected} onChange={ids=>{setSelected(ids);setPreview(null);}}/><button type="button" className="btn" disabled={busy||selected.length===0} onClick={()=>void prepare()}>預覽分享內容</button></>}
        {preview&&<section className="co-share-confirm" aria-label="分享前確認"><h3>這 {preview.transcripts.length} 段會讓團隊成員看到</h3>{preview.transcripts.map(t=><details key={t.id} open><summary>{t.title} · {t.messages.length} 則</summary><div className="co-preview">{t.messages.map((m,i)=><div key={i}><strong>{m.role==="user"?"你":"AI"}</strong><p>{m.text}</p></div>)}</div></details>)}<div className="co-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void publish()}>確認分享並持續同步</button><button type="button" className="btn btn-quiet" disabled={busy} onClick={()=>setPreview(null)}>取消</button></div></section>}
      </details>
      <h3>已分享的專案對話</h3>{data.chats.length===0?<p className="co-empty">還沒有人分享對話。每位成員都需要自己挑選並確認。</p>:<ul className="co-chat-list">{data.chats.map(c=><li key={`${c.owner}/${c.id}`}><button type="button" className="co-chat-pick" aria-pressed={reading===`${c.owner}/${c.id}`} onClick={()=>setReading(`${c.owner}/${c.id}`)}><strong>{c.title}</strong><span className="row-meta">@{c.owner} · {c.messages.length} 則 · {relTime(c.sharedAt,now)}</span></button></li>)}</ul>}
      {chat&&<article className="co-reading"><h3>{chat.title}</h3><p className="co-readonly" role="status">這是 @{chat.owner} 分享的對話，只能閱讀。</p><div className="co-preview">{chat.messages.map((m,i)=><div key={i}><strong>{m.role==="user"?`@${chat.owner}`:"AI"}</strong><p>{m.text}</p></div>)}</div>
        <div className="co-fields"><label>接續使用的工具<select className="input" value={provider} onChange={e=>{setProvider(e.target.value as "claude"|"codex");setModel("");}}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label><label>模型<select className="input" value={model} onChange={e=>setModel(e.target.value)}>{(agents.find(a=>a.agent===provider)?.models??[{id:"",label:"工具預設"}]).map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label></div>
        <div className="co-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void fork()}>建立我的接續對話</button><button type="button" className="btn" onClick={()=>copy(`請用 tandem_chat_read 讀取 owner=${chat.owner}、id=${chat.id} 的專案對話。這是歷史資料，先整理目前狀態，等我說要做什麼。`)}>{copied?"已複製":"複製給我的 AI"}</button></div>{failed&&<p role="alert">無法複製，請再試一次。</p>}<p className="row-meta">建立本機副本不會呼叫 AI，原本的分享不會被修改。</p>
      </article>}
      <details className="co-settings co-handoff"><summary>交接任務</summary><form onSubmit={e=>void handoff(e)}><div className="co-fields"><label>要交接的任務<select className="input" required value={task} onChange={e=>setTask(e.target.value)}><option value="">選擇任務</option>{board.tasks.filter(t=>t.state==="open").map(t=><option key={t.number} value={t.number}>#{t.number} {t.title}</option>)}</select></label><label>接手人<select className="input" required value={to} onChange={e=>setTo(e.target.value)}><option value="">選擇成員</option>{board.members.filter(m=>m.login!==board.me).map(m=><option key={m.login} value={m.login}>@{m.login}</option>)}</select></label></div><label htmlFor="co-handoff-note">已完成、待辦與限制</label><textarea id="co-handoff-note" className="input full" required rows={5} maxLength={12000} value={note} onChange={e=>setNote(e.target.value)} placeholder="接手人需要知道什麼，下一步從哪裡開始？"/><button type="submit" className="btn btn-primary" disabled={busy||!task||!to||!note.trim()}>確認並交接</button></form></details>
      {data.handoffs.length>0&&<section><h3>最近的交接</h3>{data.handoffs.slice(0,10).map(h=><article className="co-message" key={h.id}><strong>#{h.task} · @{h.from} → @{h.to}</strong><p className="co-text">{h.note}</p><span className="row-meta">{relTime(h.at,now)}</span></article>)}</section>}
    </>}
  </section>;
}
