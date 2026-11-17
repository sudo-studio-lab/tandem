import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import { createMcpServer } from "./mcp.ts";
import { offlineContext } from "./test-context.ts";
import { localAgentSettings } from "./agent-messages.ts";

it("the answering MCP exposes only four read tools; a remote flag cannot grant local consent",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tandem-readonly-"));
  const old=process.env.TANDEM_HOME;process.env.TANDEM_HOME=dir;
  const ctx=offlineContext(dir,"alice");
  const client=new Client({name:"test",version:"1"});
  try{
    const server=createMcpServer(async()=>ctx,undefined,{readOnly:true});
    const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
    const names=(await client.listTools()).tools.map(t=>t.name).sort();
    expect(names).toEqual(["tandem_context_list","tandem_context_read","tandem_decisions","tandem_task_list"]);
    expect((await localAgentSettings(ctx)).enabled).toBe(false);
    await ctx.store.write([{path:"tandem/agents/alice.json",content:JSON.stringify({projects:{"test/test":{enabled:true}}})}],"fixture");
    expect((await localAgentSettings(ctx)).enabled).toBe(false);
  }finally{await client.close();if(old===undefined)delete process.env.TANDEM_HOME;else process.env.TANDEM_HOME=old;await fs.rm(dir,{recursive:true,force:true});}
});
