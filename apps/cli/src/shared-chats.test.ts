import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {offlineContext} from "./test-context.ts";
import {sharedChats} from "@tandem/core";
import {projectTranscripts} from "./project-transcripts.ts";
import {previewSharing,confirmSharing,sharingSettings,stopSharing,syncSharedChats} from "./shared-chats.ts";
vi.mock("./project-transcripts.ts",()=>({projectTranscripts:vi.fn()}));
const dirs:string[]=[];const old=process.env.TANDEM_HOME;
afterEach(async()=>{if(old===undefined)delete process.env.TANDEM_HOME;else process.env.TANDEM_HOME=old;for(const d of dirs.splice(0))await fs.rm(d,{recursive:true,force:true});});
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tandem-share-preview-"));dirs.push(dir);process.env.TANDEM_HOME=dir;const c=offlineContext(dir,"alice");c.dataRepo.separate=true;c.dataGh={getRepo:async()=>({private:true})} as any;return c;}
const transcript=()=>({id:"a".repeat(64),source:"codex" as const,title:"This project",updatedAt:new Date().toISOString(),messages:[{role:"user" as const,text:"Only share after preview"}]});
beforeEach(()=>vi.mocked(projectTranscripts).mockResolvedValue([transcript()]));
it("requires a fresh explicit preview, binds it to the project, and detects content changes",async()=>{
 const c=await fixture();expect((await sharingSettings(c)).enabled).toBe(false);
 await expect(confirmSharing(c,"forged-token")).rejects.toThrow("預覽");
 const preview=await previewSharing(c,["a".repeat(64)]);expect(await sharedChats(c.store,"test/test")).toEqual([]);
 vi.mocked(projectTranscripts).mockResolvedValue([{...transcript(),messages:[{role:"user",text:"New private content"}]}]);
 await expect(confirmSharing(c,preview.token)).rejects.toThrow("新內容");expect(await sharedChats(c.store,"test/test")).toEqual([]);
 const next=await previewSharing(c,["a".repeat(64)]);await confirmSharing(c,next.token);
 expect((await sharingSettings(c)).enabled).toBe(true);expect(await sharedChats(c.store,"test/test")).toHaveLength(1);
 await stopSharing(c);expect((await sharingSettings(c)).enabled).toBe(false);expect(await sharedChats(c.store,"test/test")).toEqual([]);
});
it("does not accept another project's preview or credentials",async()=>{
 const c=await fixture();const p=await previewSharing(c,["a".repeat(64)]);c.remote.name="another";await expect(confirmSharing(c,p.token)).rejects.toThrow("預覽");
 vi.mocked(projectTranscripts).mockResolvedValue([{...transcript(),messages:[{role:"user",text:"ghp_"+"a".repeat(36)}]}]);await expect(previewSharing(c,["a".repeat(64)])).rejects.toThrow();
});
it("refuses a separate public data repo before reading personal transcripts",async()=>{
 const c=await fixture();c.dataGh={getRepo:async()=>({private:false})} as any;vi.mocked(projectTranscripts).mockClear();
 await expect(previewSharing(c,["a".repeat(64)])).rejects.toThrow("公開");expect(projectTranscripts).not.toHaveBeenCalled();
});
it("reports a failed privacy recheck without reading or publishing new transcript content",async()=>{
 const c=await fixture();const p=await previewSharing(c,["a".repeat(64)]);await confirmSharing(c,p.token);
 c.dataGh={getRepo:async()=>({private:false})} as any;vi.mocked(projectTranscripts).mockClear();
 await syncSharedChats(c);expect(projectTranscripts).not.toHaveBeenCalled();
 expect((await sharingSettings(c)).lastError).toContain("私人資料 repo");
 expect((await sharedChats(c.store,"test/test"))[0]?.messages[0]?.text).toBe("Only share after preview");
});
