import { randomUUID } from "node:crypto";
import { TandemError, type Handoff } from "@tandem/contracts";
import { assertNoSecrets, sharedProjectKey } from "@tandem/core";
import {requirePrivateDataRepo,type Context} from "./context.ts";
import { projectKey } from "./agent-messages.ts";
const prefix=(ctx:Context)=>`tandem/handoffs/${sharedProjectKey(projectKey(ctx))}`;
export async function createHandoff(ctx:Context,input:{task:number;to:string;note:string}){
  await requirePrivateDataRepo(ctx);
  if(!ctx.dataRepo.separate)throw new TandemError("validation","交接筆記需要獨立的私人團隊資料 repo");
  if(!Number.isSafeInteger(input.task)||input.task<=0||!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(input.to)||typeof input.note!=="string"||!input.note.trim()||input.note.length>12000)throw new TandemError("validation","請選任務、接手人，並填寫交接筆記（最多 12000 字）");
  assertNoSecrets(input.note);
  const [tasks,members,repo]=await Promise.all([ctx.gh.listIssues({state:"all"}),ctx.gh.listCollaborators(),ctx.gh.getRepo()]);
  const task=tasks.find(t=>t.number===input.task&&t.state==="open");
  if(!task)throw new TandemError("validation","找不到這個開放中的任務");
  if(!repo.permissions.admin&&task.author.toLowerCase()!==ctx.me.toLowerCase()&&!task.assignees.some(a=>a.toLowerCase()===ctx.me.toLowerCase()))throw new TandemError("validation","只能交接自己負責或建立的任務");
  if(!members.some(m=>m.toLowerCase()===input.to.toLowerCase()))throw new TandemError("validation","接手人還不是這個專案的成員");
  const handoff:Handoff={id:randomUUID(),project:projectKey(ctx),task:input.task,from:ctx.me,to:input.to,note:input.note.trim(),at:new Date().toISOString()};
  const base=`${prefix(ctx)}/${handoff.id}`;
  const write=await ctx.store.write([{path:`${base}/note.json`,content:JSON.stringify(handoff)+"\n",createOnly:true}],"tandem: prepare task handoff");
  if(write.result!=="pushed")throw new TandemError("validation","交接筆記尚未同步，未更改任務指派。請連線後再試");
  await ctx.gh.assignIssue(input.task,[input.to]);
  const confirmed=await ctx.store.write([{path:`${base}/confirmed.json`,content:JSON.stringify({at:handoff.at})+"\n",createOnly:true}],"tandem: confirm task handoff");
  return {handoff,write:confirmed};
}
export async function listHandoffs(ctx:Context):Promise<Handoff[]>{
  if(!ctx.dataRepo.separate)return [];
  const out:Handoff[]=[];
  for(const file of await ctx.store.tree(prefix(ctx))){
    if(!file.path.endsWith("/note.json"))continue;
    let h:Handoff;try{h=JSON.parse(await ctx.store.read(file.path)??"null");}catch{continue;}
    if(!h||h.project!==projectKey(ctx)||!Number.isSafeInteger(h.task)||typeof h.id!=="string"||file.path!==`${prefix(ctx)}/${h.id}/note.json`||typeof h.note!=="string"||typeof h.at!=="string"||typeof h.to!=="string"||typeof h.from!=="string")continue;
    if(!await ctx.store.read(`${prefix(ctx)}/${h.id}/confirmed.json`))continue;
    try{assertNoSecrets(JSON.stringify(h));}catch{continue;}
    out.push(h);
  }
  return out.sort((a,b)=>b.at.localeCompare(a.at));
}
