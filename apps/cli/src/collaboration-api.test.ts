import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {expect,it,vi} from "vitest";
import {advertiseAgent,updateAppState,openFsDataStore} from "@tandem/core";
import {offlineContext} from "./test-context.ts";
import {startServer} from "./server.ts";
const fixture=vi.hoisted(()=>({ctx:null as any,gh:null as any}));
vi.mock("@tandem/core",async original=>({...await original<any>(),getGitHubToken:async()=>({token:"fixture-only",source:"env"}),createGitHubClient:()=>fixture.gh}));
vi.mock("./context.ts",async original=>({...await original<any>(),openContext:async()=>fixture.ctx}));
vi.mock("./project-transcripts.ts",()=>({projectTranscripts:async()=>[{id:"a".repeat(64),source:"codex",title:"Fixture conversation",updatedAt:new Date().toISOString(),messages:[{role:"user",text:"Fixture requirement"},{role:"assistant",text:"Fixture progress"}]}]}));

it("serves the authorized collaboration flow through HTTP and stores content only in the data repo",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"tandem-api-"));const previous=process.env.TANDEM_HOME;process.env.TANDEM_HOME=path.join(root,"app");
 const code=path.join(root,"code"),data=path.join(root,"data");await fs.mkdir(code);await fs.mkdir(data);
 for(const folder of [code,data])execFileSync("git",["init","-q","-b","main"],{cwd:folder});
 const at=new Date().toISOString();const assign=vi.fn(async()=>{});
 fixture.gh={viewerLogin:async()=>"alice",getRepo:async()=>({private:false,defaultBranch:"main",permissions:{admin:true,push:true,pull:true}}),listDiscussions:async()=>[],listPullRequests:async()=>[],listIssues:async()=>[{number:1,title:"Fixture task",url:"https://github.com/o/code/issues/1",state:"open",author:"alice",assignees:["alice"],labels:["tandem:task"],blockedBy:[],createdAt:at,updatedAt:at}],listCollaborators:async()=>["alice","bob"],getActivityRaw:async()=>({commits:[],pullRequests:[],comments:[]}),assignIssue:assign};
 const ctx=offlineContext(code,"alice");ctx.store=openFsDataStore(data);ctx.remote={owner:"o",name:"code",url:"https://github.com/o/code"};ctx.gh=fixture.gh;ctx.dataRoot=data;ctx.dataRepo={owner:"o",name:"data",url:"https://github.com/o/data",separate:true};ctx.dataGh={getRepo:async()=>({private:true,permissions:{admin:true}})} as any;fixture.ctx=ctx;
 await updateAppState(s=>{s.projects=[{id:"o/code",owner:"o",name:"code",path:code,lastOpenedAt:at}];s.currentProjectId="o/code";});
 const server=await startServer({port:0,sessionToken:"fixture-session",openBrowser:false,desktop:true});
 const url=`http://127.0.0.1:${server.port}`;const base="/api/projects/o%2Fcode";
 const request=async(method:string,route:string,body?:unknown)=>{const r=await fetch(url+route,{method,headers:{authorization:"Bearer fixture-session",...(body!==undefined?{"content-type":"application/json"}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json() as any};};
 try{
   expect((await fetch(url+base+"/agent-messages")).status).toBe(401);
   const initial=await request("GET",base+"/agent-messages");expect(initial.status).toBe(200);expect(initial.body.settings.enabled).toBe(false);
   await advertiseAgent(ctx.store,"o/code","bob",true);
   const question=await request("POST",base+"/agent-messages",{to:"bob",text:"Fixture question"});expect(question.status).toBe(200);
   expect((await request("GET",base+"/agent-messages")).body.messages[0].request.from).toBe("alice");
   expect((await request("POST",base+"/agent-messages",{to:"bob",text:"ghp_"+"a".repeat(36)})).status).toBe(400);
   const preview=await request("POST",base+"/shared-chats/preview",{ids:["a".repeat(64)]});expect(preview.status).toBe(200);
   expect((await request("GET",base+"/shared-chats")).body.chats).toEqual([]);
   expect((await request("POST",base+"/shared-chats/confirm",{token:preview.body.token})).status).toBe(200);
   expect((await request("GET",base+"/shared-chats")).body.chats[0].messages[0].text).toBe("Fixture requirement");
   const fork=await request("POST",base+"/shared-chats/fork",{owner:"alice",id:"a".repeat(64),provider:"codex",model:""});expect(fork.status).toBe(200);
   expect((await request("GET",`/api/chats/${fork.body.id}`)).body.items.some((m:any)=>m.text==="Fixture requirement")).toBe(true);
   expect((await request("POST",base+"/handoffs",{task:1,to:"bob",note:"Fixture handoff",confirm:true})).status).toBe(200);expect(assign).toHaveBeenCalledWith(1,["bob"]);
   expect((await request("POST",base+"/shared-chats/stop")).status).toBe(200);
   expect((await request("GET",base+"/shared-chats")).body.chats).toEqual([]);
   expect(await fs.readdir(code)).toEqual([".git"]);
 }finally{await server.close();if(previous===undefined)delete process.env.TANDEM_HOME;else process.env.TANDEM_HOME=previous;await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
