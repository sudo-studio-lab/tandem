import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {afterEach,expect,it,vi} from "vitest";
import {offlineContext} from "./test-context.ts";
import {createHandoff,listHandoffs} from "./handoffs.ts";
import {buildBrief} from "./gather.ts";
import {renderBrief} from "@tandem/core";
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await fs.rm(d,{recursive:true,force:true});});
it("only announces a confirmed handoff and gives the recipient its notes at session start",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tandem-handoff-"));dirs.push(dir);const c=offlineContext(dir,"alice");c.dataRepo.separate=true;
 execFileSync("git",["init","-q","-b","main"],{cwd:dir});
 c.dataGh={getRepo:async()=>({private:true})} as any;
 const assign=vi.fn(async()=>{throw new Error("github unavailable");});c.gh={listIssues:async()=>[{number:1,state:"open",author:"alice",assignees:["alice"]}],listCollaborators:async()=>["alice","bob"],getRepo:async()=>({permissions:{admin:false}}),assignIssue:assign} as any;
 await expect(createHandoff(c,{task:1,to:"bob",note:"UI complete; verify error handling"})).rejects.toThrow();expect(await listHandoffs(c)).toEqual([]);
 assign.mockImplementation(async()=>undefined as never);await createHandoff(c,{task:1,to:"bob",note:"UI complete; verify error handling"});expect(assign).toHaveBeenLastCalledWith(1,["bob"]);
 c.me="bob";const result=await buildBrief(c,{discussions:[],pullRequests:[],tasks:[],problems:[]});expect(result.brief.quiet).toBe(false);expect(renderBrief(result.brief)).toContain("把任務 #1 交給你");expect(renderBrief(result.brief)).toContain("verify error handling");
});
