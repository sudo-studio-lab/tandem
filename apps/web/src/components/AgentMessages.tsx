import { useCallback, useEffect, useState } from "react";
import type { AgentMember, AgentMessage, AgentMessageSettings, AgentStatus, ProjectTranscript } from "@tandem/contracts";
import { api, projectPath } from "../api.ts";
import { Spinner, errMsg } from "./ui.tsx";
import { relTime } from "../time.ts";
import { PageBar } from "./PageBar.tsx";
import { Section } from "./Group.tsx";
import "./collaboration.css";
import "./co-panel.css";

interface Data { settings: AgentMessageSettings; members: AgentMember[]; messages: AgentMessage[] }
export function TranscriptChoices({items,selected,onChange}:{items:ProjectTranscript[];selected:string[];onChange:(ids:string[])=>void}) {
  return <div className="co-transcripts">{items.length===0?<p className="muted">沒有找到這個專案可選的對話。只支援本機存有專案路徑的對話紀錄。</p>:items.map(t=><details key={t.id} className="co-transcript">
    <summary><span>{t.title}</span><span className="row-meta">{t.source} · {t.messages.length} 則</span></summary>
    <label className="co-check"><input type="checkbox" checked={selected.includes(t.id)} onChange={()=>onChange(selected.includes(t.id)?selected.filter(id=>id!==t.id):[...selected,t.id])}/>使用這段對話</label>
    <div className="co-preview">{t.messages.map((m,i)=><div key={i}><strong>{m.role==="user"?"你":"AI"}</strong><p>{m.text}</p></div>)}</div>
  </details>)}</div>;
}
export function AgentMessagesPage({projectId,me,now,onBack}:{projectId:string;me:string;now:number;onBack:()=>void}) {
  const [data,setData]=useState<Data|null>(null);const [settings,setSettings]=useState<AgentMessageSettings|null>(null);
  const [agents,setAgents]=useState<AgentStatus[]>([]);const [transcripts,setTranscripts]=useState<ProjectTranscript[]|null>(null);
  const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
  const [showArchived,setShowArchived]=useState(false);
  const load=useCallback(async()=>{try{const d=await api<Data>("GET",projectPath(projectId,"/agent-messages"));setData(d);setSettings(s=>s??d.settings);setError(null);}catch(e){setError(errMsg(e));}},[projectId]);
  useEffect(()=>{void load();const t=setInterval(()=>void load(),15000);void api<AgentStatus[]>("GET","/api/agents").then(setAgents).catch(()=>undefined);return()=>clearInterval(t);},[load]);
  const selectTranscripts=async()=>{setError(null);try{setTranscripts(await api<ProjectTranscript[]>("GET",projectPath(projectId,"/local-transcripts")));}catch(e){setError(errMsg(e));}};
  const save=async()=>{if(!settings)return;setBusy(true);setNotice("");try{await api("PUT",projectPath(projectId,"/agent-messages/settings"),settings);await load();setNotice(settings.enabled?"已開放；只有這台電腦在線時會回答。":"已關閉，不再開始新的回答。");}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  const action=async(id:string,what:"stop"|"archive")=>{setBusy(true);try{await api("POST",projectPath(projectId,`/agent-messages/${id}/${what}`));await load();}catch(e){setError(errMsg(e));}finally{setBusy(false);}};
  const models=agents.find(a=>a.agent===settings?.provider)?.models??[];
  const mine=(login:string)=>login.toLowerCase()===me.toLowerCase();
  const shown=data?.messages.filter(m=>showArchived||!m.archived)??[];
  const archivedCount=data?.messages.filter(m=>m.archived).length??0;
  const openTo=data?.members.filter(m=>m.enabled).map(m=>mine(m.login)?"你":`@${m.login}`)??[];
  return <section className="co-page" aria-labelledby="co-agent-title">
    <PageBar title="Agent 問答" titleId="co-agent-title" onBack={onBack} />
    <p className="muted co-lead">隊友的 agent 可以問專案問題；你的 agent 只回答，不能替你動手。</p>
    {error&&<p className="banner banner-error" role="alert">{error} <button type="button" className="btn btn-small" onClick={()=>void load()}>重新載入</button></p>}
    {!data&&!error&&<Spinner label="載入問答中…"/>}
    {data&&<div className="tb">
      <Section label="問答紀錄" end={shown.length} open>
        <p className="co-meta">已開放回答：{openTo.join("、")||"還沒有人"}。這裡只能閱讀、停止或封存；要提問請在你原本的 AI 對話裡說。</p>
        {archivedCount>0&&<label className="co-check"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/>顯示已封存（{archivedCount}）</label>}
        {shown.length===0&&<p className="co-empty">還沒有問答。你的 agent 可以用 Tandem 工具問已開放的成員。</p>}
        {shown.map(m=><article className="co-message" key={m.request.id}>
          <header><strong>@{m.request.from} 問 {mine(m.request.to)?"你":`@${m.request.to}`}</strong><span className="row-meta">{mine(m.request.from)?"你的 agent 問的":"隊友的 agent 問的"}・{relTime(m.request.at,now)}</span></header>
          <p className="co-text">{m.request.text}</p>
          {m.reply?<div className="co-answer"><p className="co-meta">{m.reply.status==="answered"?"回答":"沒有答完"}</p><p className="co-text">{m.reply.text}</p></div>:<p className="co-meta">{m.stopped?"已要求停止，對方同步後會中止回答":"等對方的電腦在線並回答"}</p>}
          <footer>{!m.reply&&!m.stopped&&<button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={()=>void action(m.request.id,"stop")}>停止這次問答</button>}{m.archived?<span className="row-meta">已封存，只影響你的清單</span>:<button type="button" className="btn btn-small btn-quiet" disabled={busy} onClick={()=>void action(m.request.id,"archive")}>從我的清單封存</button>}</footer>
        </article>)}
      </Section>
      {settings&&<Section label="我的回答設定" end={data.settings.enabled?"已開放":"尚未開放"} open={!data.settings.enabled&&data.messages.length===0}>
        <p className="co-meta">開放後會使用你選的工具與額度。隊友不能替你開啟；你隨時可以關閉。</p>
        <label className="co-check"><input type="checkbox" checked={settings.enabled} onChange={e=>setSettings({...settings,enabled:e.target.checked})}/>允許我的 agent 回答</label>
        <div className="co-fields"><label>使用工具<select className="input" value={settings.provider} onChange={e=>setSettings({...settings,provider:e.target.value as "claude"|"codex",model:"",effort:undefined})}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
          <label>模型<select className="input" value={settings.model} onChange={e=>setSettings({...settings,model:e.target.value})}>{models.length?models.map(m=><option key={m.id} value={m.id}>{m.label}</option>):<option value="">工具預設</option>}</select></label>
        </div>
        <p>預設只用團隊共享脈絡與任務板。你也可以選擇這個專案的對話，提供回答時的背景。</p>
        <button type="button" className="btn" onClick={()=>void selectTranscripts()}>選擇可用的專案對話</button>
        {transcripts&&<TranscriptChoices items={transcripts} selected={settings.transcriptIds} onChange={ids=>setSettings({...settings,transcriptIds:ids})}/>}
        <p className="row-meta">已選 {settings.transcriptIds.length} 段；不會把對話全文貼到問答紀錄。</p>
        <div className="co-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void save()}>{busy?"儲存中…":"儲存回答設定"}</button></div>
      </Section>}
      {notice&&<p role="status" className="banner co-notice">{notice}</p>}
    </div>}
  </section>;
}
