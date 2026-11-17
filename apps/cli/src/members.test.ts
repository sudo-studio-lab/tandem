import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { offlineContext } from "./test-context.ts";
import { currentShareLink, removeProjectMember, resetShareLink } from "./members.ts";
const dirs:string[]=[];const previous=process.env.TANDEM_HOME;
afterEach(async()=>{if(previous===undefined)delete process.env.TANDEM_HOME;else process.env.TANDEM_HOME=previous;for(const d of dirs.splice(0))await fs.rm(d,{recursive:true,force:true});});
async function context(admin=true){const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tandem-members-"));dirs.push(dir);process.env.TANDEM_HOME=dir;const ctx=offlineContext(dir,"alice");ctx.dataRepo.separate=true;ctx.gh={getRepo:async()=>({permissions:{admin}}),removeCollaborator:vi.fn(async()=>{}),hasCollaborator:async()=>false} as any;return ctx;}
it("rotates join secrets without putting them in git and refuses non-admin resets",async()=>{
  const ctx=await context();const first=await resetShareLink(ctx);expect(first.url).toMatch(/^tandem:\/\/join\?.+#share=[A-Za-z0-9_-]{43}$/);
  const secret=new URL(first.url!).hash.slice(7);const files=await ctx.store.tree("tandem/invites");expect(files).toHaveLength(1);expect(await ctx.store.read(files[0]!.path)).not.toContain(secret);
  expect(await currentShareLink(ctx)).toBe(first.url);const second=await resetShareLink(ctx);expect(second.url).not.toBe(first.url);
  ctx.gh.getRepo=async()=>({permissions:{admin:false,push:true,pull:true},private:true,defaultBranch:"main"});await expect(resetShareLink(ctx)).rejects.toThrow("管理者");
});
it("does not misreport inherited or partial access removal as complete",async()=>{
  const ctx=await context();ctx.dataGh={getRepo:async()=>({permissions:{admin:true}}),removeCollaborator:async()=>{throw Error("blocked");},hasCollaborator:async()=>true} as any;
  const result=await removeProjectMember(ctx,"bob");expect(result.complete).toBe(false);expect(result.results.some(r=>!r.removed)).toBe(true);
  ctx.dataGh=undefined;ctx.gh.hasCollaborator=async()=>true;expect((await removeProjectMember(ctx,"bob")).complete).toBe(false);
});
