import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { extractTranscript, projectTranscripts } from "./project-transcripts.ts";
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await fs.rm(d,{recursive:true,force:true});});
it("refuses cross-project transcripts and omits tool results and injected context",()=>{
  const cwd=path.resolve("project-a");
  const rows=[{type:"session_meta",payload:{cwd}},{type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"Status?"}]}},{type:"response_item",payload:{type:"function_call_output",output:"private tool content"}},{type:"response_item",payload:{type:"message",role:"assistant",content:[{type:"output_text",text:"Ready"}]}}];
  const raw=rows.map(x=>JSON.stringify(x)).join("\n");
  expect(extractTranscript("codex",raw,path.resolve("project-b"))).toBeNull();
  expect(extractTranscript("codex",raw,cwd)).toEqual([{role:"user",text:"Status?"},{role:"assistant",text:"Ready"}]);
  expect(extractTranscript("codex",raw+"\n"+JSON.stringify({type:"turn_context",payload:{cwd:path.resolve("project-b")}}),cwd)).toBeNull();
});
it("discovers only the declared project, blocks secrets and exposes no local paths",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tandem-transcripts-"));dirs.push(dir);const cwd=path.join(dir,"code");await fs.mkdir(cwd);
  const codexHome=path.join(dir,"codex");await fs.mkdir(path.join(codexHome,"sessions"),{recursive:true});
  for(const [name,project,text] of [["yes",cwd,"hello"],["no",dir,"other project"],["secret",cwd,"ghp_"+"a".repeat(36)]])await fs.writeFile(path.join(codexHome,"sessions",`${name}.jsonl`),[{type:"session_meta",payload:{cwd:project}},{type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text}]}}].map(x=>JSON.stringify(x)).join("\n"));
  const result=await projectTranscripts(cwd,{codexHome,claudeHome:path.join(dir,"claude")});
  expect(result).toHaveLength(1);expect(result[0]?.title).toBe("hello");expect(JSON.stringify(result)).not.toContain(dir);
});
