import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { TandemError } from "@tandem/contracts";
import { appStateDir, gitBlobSha, requirePrivateMessages, syncData } from "@tandem/core";
import type { Context } from "./context.ts";
import { projectKey, saveAgentSettings, localAgentSettings } from "./agent-messages.ts";
import { stopSharing } from "./shared-chats.ts";

const key=(ctx:Context)=>createHash("sha256").update(projectKey(ctx)).digest("hex");
const sharePath=(ctx:Context)=>`tandem/invites/${key(ctx)}.json`;
const localLink=(ctx:Context)=>path.join(appStateDir(),"join-links",`${key(ctx)}.json`);
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
async function readShare(ctx:Context):Promise<{digest:string}|null>{const raw=await ctx.store.read(sharePath(ctx));if(raw===null)return null;try{return JSON.parse(raw);}catch{throw new TandemError("validation","加入連結資料無法讀取，請管理者重新產生");}}
export async function currentShareLink(ctx:Context):Promise<string|null>{
  const state=await readShare(ctx);if(!state)return null;
  let token:string;try{token=JSON.parse(await fs.readFile(localLink(ctx),"utf8")).secret;}catch{return null;}
  if(typeof token!=="string"||hash(token)!==state.digest)return null;
  return `tandem://join?repo=${encodeURIComponent(projectKey(ctx))}#share=${token}`;
}
export async function resetShareLink(ctx:Context){
  requirePrivateMessages(ctx.dataRepo.separate);
  if(!(await ctx.gh.getRepo()).permissions.admin)throw new TandemError("validation","只有專案管理者可以重設加入連結");
  const before=await ctx.store.read(sharePath(ctx));const secret=randomBytes(32).toString("base64url");
  const result=await ctx.store.write([{path:sharePath(ctx),content:JSON.stringify({digest:hash(secret),updatedAt:new Date().toISOString(),by:ctx.me})+"\n",expectVersion:before?gitBlobSha(Buffer.from(before)):null}],"tandem: reset project join link");
  if(result.result!=="pushed")throw new TandemError("conflict","連結尚未完成同步，請連線後重新產生");
  await fs.mkdir(path.dirname(localLink(ctx)),{recursive:true});
  await fs.writeFile(localLink(ctx),JSON.stringify({secret}),{mode:0o600});
  return {url:await currentShareLink(ctx)};
}
export async function verifyShareLink(ctx:Context,secret:string|undefined){
  const synced=await syncData(ctx.dataRoot,{gitEnv:ctx.gitEnv});
  if(synced.result==="offline"||synced.result==="conflict")throw new TandemError("validation","目前無法確認加入連結是否有效，請連線後再試");
  const state=await readShare(ctx);
  if(!state){if(secret)throw new TandemError("validation","這個加入連結已失效，請向專案管理者索取新的連結");return;}
  if(!secret||!/^[A-Za-z0-9_-]{43}$/.test(secret)||typeof state.digest!=="string"||!/^[a-f0-9]{64}$/.test(state.digest)||!timingSafeEqual(Buffer.from(hash(secret)),Buffer.from(state.digest)))throw new TandemError("validation","這個加入連結已失效，請向專案管理者索取新的連結。GitHub 邀請與加入連結分開管理。");
}
export async function projectMembers(ctx:Context){
  const [info,members]=await Promise.all([ctx.gh.getRepo(),ctx.gh.listProjectMembers()]);
  return {me:ctx.me,members,canManage:info.permissions.admin,canLeave:ctx.me.toLowerCase()!==ctx.remote.owner.toLowerCase(),url:ctx.dataRepo.separate?await currentShareLink(ctx):null,separate:ctx.dataRepo.separate,dataRepo:ctx.dataRepo.separate?`${ctx.dataRepo.owner}/${ctx.dataRepo.name}`:null};
}
export async function removeProjectMember(ctx:Context,login:string,leave=false){
  if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login))throw new TandemError("validation","GitHub 帳號格式不對");
  const self=login.toLowerCase()===ctx.me.toLowerCase();
  if(leave&&!self)throw new TandemError("validation","只能自行離開");
  if(login.toLowerCase()===ctx.remote.owner.toLowerCase()||ctx.dataRepo.separate&&login.toLowerCase()===ctx.dataRepo.owner.toLowerCase())throw new TandemError("validation","repo 擁有者不能從專案移除，請先在 GitHub 轉移所有權");
  const clients=[{repo:projectKey(ctx),client:ctx.gh},...(ctx.dataGh?[{repo:`${ctx.dataRepo.owner}/${ctx.dataRepo.name}`,client:ctx.dataGh}]:[])];
  if(!self)for(const c of clients)if(!(await c.client.getRepo()).permissions.admin)throw new TandemError("validation",`需要 ${c.repo} 的管理權限才能移除成員`);
  if(self&&ctx.dataRepo.separate)await saveAgentSettings(ctx,{...await localAgentSettings(ctx),enabled:false}).catch(()=>undefined);
  if(self&&ctx.dataRepo.separate)await stopSharing(ctx);
  const results=[];
  // Remove data access before code access so a code-repo failure is visible as a partial result.
  for(const c of [...clients].reverse()){
    try{await c.client.removeCollaborator(login);results.push({repo:c.repo,removed:true,remainingAccess:await c.client.hasCollaborator(login)});}
    catch{results.push({repo:c.repo,removed:false,remainingAccess:true});}
  }
  return {complete:results.every(r=>r.removed&&!r.remainingAccess),results};
}
