import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TandemError, type ProjectTranscript, type SharedChatSettings } from "@tandem/contracts";
import { appStateDir, assertNoSecrets, publishChat, requirePrivateMessages, sharedChatDigest, sharedChats, sharedProjectKey, withdrawOwnChats, withFileLock } from "@tandem/core";
import {requirePrivateDataRepo,type Context} from "./context.ts";
import { projectKey } from "./agent-messages.ts";
import { projectTranscripts } from "./project-transcripts.ts";

const dir=(ctx:Context)=>path.join(appStateDir(),"sharing",sharedProjectKey(projectKey(ctx)),ctx.me.toLowerCase());
const previews=new Map<string,{project:string;me:string;expires:number;transcripts:ProjectTranscript[]}>();
export async function sharingSettings(ctx:Context):Promise<SharedChatSettings>{
  try{const s=JSON.parse(await fs.readFile(path.join(dir(ctx),"settings.json"),"utf8"));return {enabled:s.enabled===true,transcriptIds:Array.isArray(s.transcriptIds)?s.transcriptIds.filter((x:unknown)=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x)).slice(0,20):[],...(typeof s.lastError==="string"?{lastError:s.lastError}:{})};}
  catch{return {enabled:false,transcriptIds:[]};}
}
async function save(ctx:Context,settings:SharedChatSettings){const folder=dir(ctx);await fs.mkdir(folder,{recursive:true});const tmp=path.join(folder,`${randomUUID()}.tmp`);await fs.writeFile(tmp,JSON.stringify(settings),{mode:0o600});await fs.rename(tmp,path.join(folder,"settings.json"));}
export async function previewSharing(ctx:Context,ids:string[]){
  requirePrivateMessages(ctx.dataRepo.separate);
  await requirePrivateDataRepo(ctx);
  if(!Array.isArray(ids)||ids.length===0||ids.length>20||ids.some(id=>typeof id!=="string"||!/^[a-f0-9]{64}$/.test(id)))throw new TandemError("validation","請選 1 到 20 段這個專案的對話");
  const all=await projectTranscripts(ctx.repoRoot,{project:projectKey(ctx)});
  const transcripts=all.filter(t=>ids.includes(t.id));
  assertNoSecrets(JSON.stringify(transcripts));
  if(new Set(ids).size!==transcripts.length)throw new TandemError("validation","選取的對話無法讀取，可能已搬動或含有疑似憑證");
  if(transcripts.some(t=>Buffer.byteLength(JSON.stringify(t))>500*1024))throw new TandemError("validation","選取的對話太長，請先拆成較短的專案對話再分享");
  for(const [id,p] of previews)if(p.expires<Date.now())previews.delete(id);
  const token=randomUUID();previews.set(token,{project:projectKey(ctx),me:ctx.me,expires:Date.now()+10*60_000,transcripts});
  return {token,transcripts};
}
export async function confirmSharing(ctx:Context,token:string){
  requirePrivateMessages(ctx.dataRepo.separate);
  await requirePrivateDataRepo(ctx);
  const p=previews.get(token);
  if(!p||p.project!==projectKey(ctx)||p.me!==ctx.me||p.expires<Date.now())throw new TandemError("validation","預覽已過期，請重新查看要分享的內容");
  const now=await projectTranscripts(ctx.repoRoot,{project:projectKey(ctx)});
  if(p.transcripts.some(t=>{const n=now.find(x=>x.id===t.id);return !n||sharedChatDigest(n)!==sharedChatDigest(t);}))throw new TandemError("conflict","預覽後對話又有新內容，請重新預覽再分享");
  await fs.mkdir(dir(ctx),{recursive:true});
  await withFileLock(path.join(dir(ctx),"sync.lock"),async()=>{
    for(const t of p.transcripts){const w=await publishChat(ctx.store,projectKey(ctx),ctx.me,t);if(w.result!=="pushed")throw new TandemError("validation","目前無法同步全部選取內容，已送出的仍保留。請重新預覽後再試，或關閉分享以撤回。");}
    const removed=await withdrawOwnChats(ctx.store,projectKey(ctx),ctx.me,p.transcripts.map(t=>t.id));
    if(removed.result!=="pushed")throw new TandemError("validation","尚未撤回先前未選取的對話，請連線後重新確認");
    await save(ctx,{enabled:true,transcriptIds:p.transcripts.map(t=>t.id)});previews.delete(token);
  });
  return sharingSettings(ctx);
}
export async function stopSharing(ctx:Context){
  requirePrivateMessages(ctx.dataRepo.separate);
  await fs.mkdir(dir(ctx),{recursive:true});
  return withFileLock(path.join(dir(ctx),"sync.lock"),async()=>{
    await save(ctx,{enabled:false,transcriptIds:[]});
    const write=await withdrawOwnChats(ctx.store,projectKey(ctx),ctx.me);
    return {enabled:false,write};
  });
}
const running=new Set<string>();
export async function syncSharedChats(ctx:Context){
  const key=dir(ctx);if(running.has(key)||!ctx.dataRepo.separate)return;running.add(key);
  try{
    if(!(await sharingSettings(ctx)).enabled)return;
    await withFileLock(path.join(key,"sync.lock"),async()=>{
      const settings=await sharingSettings(ctx);if(!settings.enabled)return;
      try{await requirePrivateDataRepo(ctx);const transcripts=await projectTranscripts(ctx.repoRoot,{project:projectKey(ctx)});
        for(const id of settings.transcriptIds){const t=transcripts.find(t=>t.id===id);if(!t)throw new Error("unavailable");const w=await publishChat(ctx.store,projectKey(ctx),ctx.me,t);if(w.result!=="pushed")throw new Error("pending");}
        await save(ctx,{...settings,lastError:undefined});
      }catch{await save(ctx,{...settings,lastError:"暫時無法確認私人資料 repo 或同步選取內容，也可能是新內容含疑似憑證。隊友仍只看到上次成功的版本。"});}
    });
  }finally{running.delete(key);}
}
export async function sharedChatFor(ctx:Context,owner:string,id:string){
  requirePrivateMessages(ctx.dataRepo.separate);
  const chat=(await sharedChats(ctx.store,projectKey(ctx))).find(c=>c.owner.toLowerCase()===owner.toLowerCase()&&c.id===id);
  if(!chat)throw new TandemError("validation","找不到這段分享，可能已撤回");return chat;
}
