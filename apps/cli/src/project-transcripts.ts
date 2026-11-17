/** Only user/assistant text from a transcript whose recorded cwd matches this project. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { appStateDir, assertNoSecrets } from "@tandem/core";
import type { ProjectTranscript } from "@tandem/contracts";

const MAX_FILE = 8 * 1024 * 1024;
const idFor = (file: string) => createHash("sha256").update(file).digest("hex");
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
async function canonical(p: string) { return fs.realpath(p).catch(()=>path.resolve(p)); }
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(x=>x && ["text","input_text","output_text"].includes(x.type) && typeof x.text === "string").map(x=>x.text).join("\n");
}
async function filesUnder(dir: string, suffix: string, depth: number): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir,e.name);
    if (e.isFile() && e.name.endsWith(suffix)) out.push(p);
    else if (e.isDirectory() && depth > 0) out.push(...await filesUnder(p,suffix,depth-1));
  }
  return out;
}
export function extractTranscript(source: "claude" | "codex", raw: string, cwd: string): ProjectTranscript["messages"] | null {
  let matched = false;
  const rows: any[] = [];
  for (const line of raw.split(/\r?\n/)) {
    let r: any; try { r = JSON.parse(line); } catch { continue; }
    const declared = source === "codex" && ["session_meta","turn_context"].includes(r.type) ? r.payload?.cwd : r.cwd;
    if (typeof declared === "string") {
      if (!samePath(path.resolve(declared),path.resolve(cwd))) return null;
      matched = true;
    }
    rows.push(r);
  }
  if (!matched) return null;
  const messages: ProjectTranscript["messages"] = [];
  for (const r of rows) {
    const m = source === "claude" ? r.message : r.type === "response_item" && r.payload?.type === "message" ? r.payload : null;
    if (!m || !["user","assistant"].includes(m.role)) continue;
    const text = textOf(m.content).trim();
    if (!text) continue;
    try{assertNoSecrets(text);}catch{return null;}
    // System context and tool results can contain unrelated/private material. Do not export them.
    if (m.role === "user" && /<(?:environment_context|INSTRUCTIONS|system-reminder)>|^# AGENTS\.md instructions|^Context handoff/.test(text)) continue;
    messages.push({role:m.role,text:text.slice(0,24000)});
  }
  return messages.slice(-100);
}
export async function projectTranscripts(cwd: string, opts: { claudeHome?: string; codexHome?: string; tandemDir?: string; project?: string } = {}): Promise<ProjectTranscript[]> {
  const realCwd = await canonical(cwd);
  const claude = opts.claudeHome ?? path.join(os.homedir(),".claude");
  const codex = opts.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(),".codex");
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g,"-");
  const candidates: {file:string;source:"claude"|"codex"}[] = [
    ...(await filesUnder(path.join(claude,"projects",encoded),".jsonl",0)).map(file=>({file,source:"claude" as const})),
    ...(await filesUnder(path.join(codex,"sessions"),".jsonl",4)).map(file=>({file,source:"codex" as const})),
  ];
  const out: ProjectTranscript[] = [];
  for (const {file,source} of candidates) {
    const stat = await fs.stat(file).catch(()=>null);
    if (!stat || stat.size>MAX_FILE) continue;
    // Inspect the header first. Other projects' bodies are never parsed or returned.
    const fd = await fs.open(file,"r");
    let header = "";
    try { const b=Buffer.alloc(16384); const r=await fd.read(b,0,b.length,0); header=b.subarray(0,r.bytesRead).toString("utf8"); } finally { await fd.close(); }
    const metadataLines=source==="codex"?header.split("\n").slice(0,1):header.split("\n");
    const declared = metadataLines.map(l=>{try{return JSON.parse(l);}catch{return null;}}).map(r=>source==="codex"&&r?.type==="session_meta"?r.payload?.cwd:r?.cwd).find(x=>typeof x==="string");
    if (!declared || !samePath(await canonical(declared),realCwd)) continue;
    const messages = extractTranscript(source,await fs.readFile(file,"utf8"),declared);
    if (!messages?.length) continue;
    try { assertNoSecrets(JSON.stringify(messages)); } catch { continue; }
    out.push({id:idFor(file),source,title:messages.find(m=>m.role==="user")?.text.slice(0,80) || "專案對話",updatedAt:stat.mtime.toISOString(),messages});
  }
  // Tandem-owned chats carry a project id. Never infer ownership from their display title.
  if (opts.project) for (const file of await filesUnder(opts.tandemDir??path.join(appStateDir(),"chats"),".json",0)) {
    const st=await fs.stat(file).catch(()=>null); if(!st||st.size>MAX_FILE) continue;
    let chat:any;try{chat=JSON.parse(await fs.readFile(file,"utf8"));}catch{continue;}
    if(chat.projectId!==opts.project||chat.room||chat.forkContext) continue;
    try{assertNoSecrets(JSON.stringify((Array.isArray(chat.items)?chat.items:[]).filter((x:any)=>["user","assistant"].includes(x.kind)).map((x:any)=>x.text)));}catch{continue;}
    const messages=(Array.isArray(chat.items)?chat.items:[]).filter((x:any)=>["user","assistant"].includes(x.kind)&&typeof x.text==="string").map((x:any)=>({role:x.kind as "user"|"assistant",text:x.text.slice(0,24000)})).slice(-100);
    if(!messages.length) continue;
    try{assertNoSecrets(JSON.stringify(messages));}catch{continue;}
    out.push({id:idFor(file),source:"tandem",title:String(chat.title||"專案對話").slice(0,80),updatedAt:st.mtime.toISOString(),messages});
  }
  return out.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100);
}
