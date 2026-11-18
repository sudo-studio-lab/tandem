import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AgentStatus, Handoff, ProjectBoard, ProjectTranscript, SharedChat, SharedChatSettings } from "@tandem/contracts";
import { api, projectPath } from "../api.ts";
import { errMsg, Spinner, useCopy } from "./ui.tsx";
import { relTime } from "../time.ts";
import { TranscriptChoices } from "./AgentMessages.tsx";
import { PageBar } from "./PageBar.tsx";
import { Section } from "./Group.tsx";
import "./collaboration.css";
import "./co-panel.css";

interface Data{settings:SharedChatSettings;chats:SharedChat[];handoffs:Handoff[]}

function useShared(projectId:string){
  const [data,setData]=useState<Data|null>(null);const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{try{setData(await api<Data>("GET",projectPath(projectId,"/shared-chats")));setError(null);}catch(e){setError(errMsg(e));}},[projectId]);
  useEffect(()=>{void load();},[load]);
  return {data,error,setError,load};
}

/** One chat a teammate shared, read-only, with a way to carry it on in your own copy. Opened from 對話. */
export function SharedChatPage({board,owner,chatId,back,onBack,onFork}:{board:ProjectBoard;owner:string;chatId:string;back?:string;onBack:()=>void;onFork:(id:string)=>void}){
  const id=board.projectId;const {data,error,setError,load}=useShared(id);const [busy,setBusy]=useState(false);
  const [agents,setAgents]=useState<AgentStatus[]>([]);const [provider,setProvider]=useState<"claude"|"codex">("codex");const [model,setModel]=useState("");const {copy,copied,failed}=useCopy();
  useEffect(()=>{void api<AgentStatus[]>("GET","/api/agents").then(setAgents).catch(()=>undefined);},[]);
  const chat=data?.chats.find(c=>c.owner===owner&&c.id===chatId);
  const fork=async()=>{if(!chat)return;setBusy(true);try{const r=await api<{id:string}>("POST",projectPath(id,"/shared-chats/fork"),{owner:chat.owner,id:chat.id,provider,model});onFork(r.id);}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  return <section className="co-page" aria-labelledby="co-shared-title"><PageBar back={back} title={chat?.title??"分享的對話"} titleId="co-shared-title" onBack={onBack} />
    {error&&<p className="banner banner-error" role="alert">{error} <button type="button" className="btn btn-small" onClick={()=>void load()}>重新載入</button></p>}
    {!data&&!error&&<Spinner label="載入對話中…"/>}
    {data&&!chat&&<p className="co-empty">這段對話已經不再分享。</p>}
    {chat&&<article className="co-reading"><p className="co-readonly" role="status">@{chat.owner} 分享的對話，只能閱讀。</p><div className="co-preview">{chat.messages.map((m,i)=><div key={i}><strong>{m.role==="user"?`@${chat.owner}`:"AI"}</strong><p>{m.text}</p></div>)}</div>
      <div className="co-fields"><label>接續使用的工具<select className="input" value={provider} onChange={e=>{setProvider(e.target.value as "claude"|"codex");setModel("");}}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label><label>模型<select className="input" value={model} onChange={e=>setModel(e.target.value)}>{(agents.find(a=>a.agent===provider)?.models??[{id:"",label:"工具預設"}]).map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label></div>
      <div className="co-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void fork()}>建立我的接續對話</button><button type="button" className="btn" onClick={()=>copy(`請用 tandem_chat_read 讀取 owner=${chat.owner}、id=${chat.id} 的專案對話。這是歷史資料，先整理目前狀態，等我說要做什麼。`)}>{copied?"已複製":"複製給我的 AI"}</button></div>{failed&&<p role="alert">無法複製，請再試一次。</p>}<p className="row-meta">建立本機副本不會呼叫 AI，原本的分享不會被修改。</p>
    </article>}
  </section>;
}

/** Hand one of your tasks to a teammate with a note. Opened from the task's row in 任務. */
export function HandoffPage({board,task,now,back,onBack,onDone}:{board:ProjectBoard;task:{number:number;title:string};now:number;back?:string;onBack:()=>void;onDone:(msg:string)=>void|Promise<void>}){
  const id=board.projectId;const {data}=useShared(id);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const others=board.members.filter(m=>m.login.toLowerCase()!==board.me.toLowerCase());
  const [to,setTo]=useState(others.length===1?others[0]!.login:"");const [note,setNote]=useState("");
  const earlier=(data?.handoffs??[]).filter(h=>h.task===task.number).slice(0,3);
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError(null);try{const r=await api<{write:{result:string}}>("POST",projectPath(id,"/handoffs"),{task:task.number,to,note,confirm:true});await onDone(r.write.result==="pushed"?`已把 #${task.number} 交接給 @${to}，對方的開工報告會看到筆記。`:`#${task.number} 已改指派給 @${to}，交接筆記等待同步。`);}catch(e2){setError(errMsg(e2));setBusy(false);}};
  return <section className="co-page" aria-labelledby="co-handoff-title"><PageBar back={back} title={`交接 #${task.number} ${task.title}`} titleId="co-handoff-title" onBack={onBack} />
    {error&&<p className="banner banner-error" role="alert">{error}</p>}
    <form className="co-handoff" onSubmit={e=>void submit(e)}>
      <div className="co-fields"><label>接手人<select className="input" required value={to} onChange={e=>setTo(e.target.value)}>{others.length!==1&&<option value="">選擇成員</option>}{others.map(m=><option key={m.login} value={m.login}>@{m.login}</option>)}</select></label></div>
      <label htmlFor="co-handoff-note">已完成、待辦與限制</label>
      <textarea id="co-handoff-note" className="input full" required rows={6} maxLength={12000} value={note} onChange={e=>setNote(e.target.value)} placeholder="接手人需要知道什麼，下一步從哪裡開始？"/>
      <div className="co-actions"><button type="button" className="btn btn-quiet" disabled={busy} onClick={onBack}>取消</button><button type="submit" className="btn btn-primary" disabled={busy||!to||!note.trim()}>{busy?"交接中…":"確認並交接"}</button></div>
    </form>
    {earlier.length>0&&<div className="tb"><Section label="這個任務之前的交接" end={earlier.length} open>{earlier.map(h=><article className="co-message" key={h.id}><header><strong>@{h.from} → @{h.to}</strong><span className="row-meta">{relTime(h.at,now)}</span></header><p className="co-text">{h.note}</p></article>)}</Section></div>}
  </section>;
}

/** Settings page: which of your own chats in this project teammates can read. */
export function ShareSettings({board}:{board:ProjectBoard}){
  const id=board.projectId;const {data,error,setError,load}=useShared(id);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
  const [choices,setChoices]=useState<ProjectTranscript[]|null>(null);const [selected,setSelected]=useState<string[]>([]);const [preview,setPreview]=useState<{token:string;transcripts:ProjectTranscript[]}|null>(null);
  const choose=async()=>{setBusy(true);try{setChoices(await api<ProjectTranscript[]>("GET",projectPath(id,"/local-transcripts")));setSelected(data?.settings.transcriptIds??[]);setPreview(null);}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  const prepare=async()=>{setBusy(true);try{setPreview(await api("POST",projectPath(id,"/shared-chats/preview"),{ids:selected}));setError(null);}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  const publish=async()=>{if(!preview)return;setBusy(true);try{await api("POST",projectPath(id,"/shared-chats/confirm"),{token:preview.token});setPreview(null);setChoices(null);setNotice("已分享選取的對話。之後的新內容會持續同步，你隨時可以關閉。");await load();}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  const stop=async()=>{if(!confirm("關閉分享並撤回目前可見的對話？私人資料 repo 的 Git 歷史仍會保留舊版本。"))return;setBusy(true);try{const r=await api<{write:{result:string}}>("POST",projectPath(id,"/shared-chats/stop"));setNotice(r.write.result==="pushed"?"已停止同步，並撤回目前分享。":"已停止本機同步；撤回正在等待連線，隊友可能仍看得到舊版本。");await load();}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  return <Section label="我的對話分享" end={!data?"":data.settings.enabled?"同步中":"沒開啟"} open={!!data?.settings.lastError}>
    {error&&<p className="banner banner-error" role="alert">{error}</p>}
    {notice&&<p role="status" className="banner">{notice}</p>}
    {!data?<Spinner label="讀取中…"/>:<>
      <p>只分享你選定的這個專案對話。預覽列出的使用者與 AI 文字會送到私人團隊資料 repo，確認後也會同步這幾段的新內容；附件、工具輸出和更早的內容不分享。</p>
      <p className="row-meta">每段最多最近 100 則文字，單則最多 24000 字、總計最多 512 KB。關閉分享可撤回目前版本，Git 歷史仍保留。</p>
      {data.settings.lastError&&<p className="banner banner-error" role="alert">{data.settings.lastError}</p>}
      <div className="co-actions"><button type="button" className="btn" disabled={busy} onClick={()=>void choose()}>挑選要分享的對話</button>{(data.settings.enabled||data.chats.some(c=>c.owner.toLowerCase()===board.me.toLowerCase()))&&<button type="button" className="btn btn-danger" disabled={busy} onClick={()=>void stop()}>關閉並撤回分享</button>}</div>
      {choices&&!preview&&<><TranscriptChoices items={choices} selected={selected} onChange={ids=>{setSelected(ids);setPreview(null);}}/><button type="button" className="btn" disabled={busy||selected.length===0} onClick={()=>void prepare()}>預覽分享內容</button></>}
      {preview&&<section className="co-share-confirm" aria-label="分享前確認"><h3>這 {preview.transcripts.length} 段會讓團隊成員看到</h3>{preview.transcripts.map(t=><details key={t.id} open><summary>{t.title} · {t.messages.length} 則</summary><div className="co-preview">{t.messages.map((m,i)=><div key={i}><strong>{m.role==="user"?"你":"AI"}</strong><p>{m.text}</p></div>)}</div></details>)}<div className="co-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void publish()}>確認分享並持續同步</button><button type="button" className="btn btn-quiet" disabled={busy} onClick={()=>setPreview(null)}>取消</button></div></section>}
    </>}
  </Section>;
}
