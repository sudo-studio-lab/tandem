import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openFsDataStore } from "./data/index.ts";
import { advertiseAgent, changeAgentMessage, listAgentMessages, replyAgentMessage, sendAgentMessage } from "./agent-messages.ts";

const dirs:string[]=[];
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tandem-messages-"));dirs.push(dir);return openFsDataStore(dir);}
afterEach(async()=>{for(const d of dirs.splice(0))await fs.rm(d,{recursive:true,force:true});});
describe("agent messages",()=>{
  it("requires a separate repo, recipient consent and project isolation",async()=>{
    const store=await fixture();const request={project:"team/code",me:"alice",to:"bob",text:"What remains?",separate:true};
    await expect(sendAgentMessage(store,{...request,separate:false})).rejects.toThrow("私人");
    await expect(sendAgentMessage(store,request)).rejects.toThrow("開放");
    await advertiseAgent(store,"team/elsewhere","bob",true);
    await expect(sendAgentMessage(store,request)).rejects.toThrow("開放");
    await advertiseAgent(store,"team/code","bob",true);
    const {id}=await sendAgentMessage(store,request);
    expect((await listAgentMessages(store,"team/code","bob"))[0]?.request.id).toBe(id);
    expect(await listAgentMessages(store,"team/elsewhere","bob")).toEqual([]);
    expect(await listAgentMessages(store,"team/code","charlie")).toEqual([]);
  });
  it("only lets the recipient answer; stop wins and archive is per person",async()=>{
    const store=await fixture();await advertiseAgent(store,"team/code","bob",true);
    const {id}=await sendAgentMessage(store,{project:"team/code",me:"alice",to:"bob",text:"Status?",separate:true});
    await expect(replyAgentMessage(store,"team/code","alice",id,"done")).rejects.toThrow("只能回答");
    await changeAgentMessage(store,"team/code","alice",id,"stop");
    await replyAgentMessage(store,"team/code","bob",id,"late reply");
    expect((await listAgentMessages(store,"team/code","alice"))[0]?.reply).toBeUndefined();
    await changeAgentMessage(store,"team/code","alice",id,"archive");
    expect((await listAgentMessages(store,"team/code","alice"))[0]?.archived).toBe(true);
    expect((await listAgentMessages(store,"team/code","bob"))[0]?.archived).toBe(false);
  });
  it("blocks credentials on both sides",async()=>{
    const store=await fixture();await advertiseAgent(store,"team/code","bob",true);
    const secret="ghp_"+"a".repeat(36);
    await expect(sendAgentMessage(store,{project:"team/code",me:"alice",to:"bob",text:secret,separate:true})).rejects.toThrow();
    const {id}=await sendAgentMessage(store,{project:"team/code",me:"alice",to:"bob",text:"Status?",separate:true});
    await expect(replyAgentMessage(store,"team/code","bob",id,secret)).rejects.toThrow();
  });
});
