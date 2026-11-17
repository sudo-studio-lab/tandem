import { createHash } from "node:crypto";
import { SharedChatSchema, TandemError, type ProjectTranscript, type SharedChat } from "@tandem/contracts";
import { assertNoSecrets } from "./context/context.ts";
import { gitBlobSha, type DataStore } from "./data/index.ts";

export const sharedProjectKey=(project:string)=>createHash("sha256").update(project.toLowerCase()).digest("hex");
const prefix=(project:string)=>`tandem/shared-chats/${sharedProjectKey(project)}`;
const chatPath=(project:string,owner:string,id:string)=>`${prefix(project)}/${owner.toLowerCase()}/${id}.json`;
export const sharedChatDigest=(chat:Pick<ProjectTranscript,"title"|"source"|"messages">)=>createHash("sha256").update(JSON.stringify({title:chat.title,source:chat.source,messages:chat.messages})).digest("hex");
export async function sharedChats(store:DataStore,project:string):Promise<SharedChat[]>{
  const result:SharedChat[]=[];
  for(const e of await store.tree(prefix(project))){
    let parsed:ReturnType<typeof SharedChatSchema.safeParse>;try{parsed=SharedChatSchema.safeParse(JSON.parse(await store.read(e.path)??"null"));}catch{continue;}
    if(!parsed.success||parsed.data.project!==project||e.path!==chatPath(project,parsed.data.owner,parsed.data.id))continue;
    try{assertNoSecrets(JSON.stringify(parsed.data));}catch{continue;}
    result.push({...parsed.data,version:e.version});
  }
  return result.sort((a,b)=>b.sharedAt.localeCompare(a.sharedAt));
}
export async function publishChat(store:DataStore,project:string,me:string,transcript:ProjectTranscript){
  const value=SharedChatSchema.parse({id:transcript.id,project,owner:me,source:transcript.source,title:transcript.title,sharedAt:new Date().toISOString(),messages:transcript.messages});
  const content=JSON.stringify(value,null,2)+"\n";
  if(Buffer.byteLength(content)>512*1024)throw new TandemError("validation","這段對話超過 512 KB，請先拆成較短的專案對話再分享");
  assertNoSecrets(content);
  const path=chatPath(project,me,value.id);const before=await store.read(path);
  if(before){try{if(sharedChatDigest(JSON.parse(before))===sharedChatDigest(value))return {result:"pushed" as const};}catch{/* replace invalid own snapshot */}}
  const write=await store.write([{path,content,expectVersion:before?gitBlobSha(Buffer.from(before)):null}],"tandem: sync own shared conversation");
  if(write.result==="conflict")throw new TandemError("conflict","分享版本已改變，請重新預覽後再試");
  return write;
}
export async function withdrawOwnChats(store:DataStore,project:string,me:string,keepIds:string[]=[]){
  const own=(await sharedChats(store,project)).filter(c=>c.owner.toLowerCase()===me.toLowerCase()&&!keepIds.includes(c.id));
  if(!own.length)return {result:"pushed" as const};
  return store.write(own.map(c=>({path:chatPath(project,me,c.id),content:null,expectVersion:c.version})),"tandem: withdraw own conversation snapshots");
}
