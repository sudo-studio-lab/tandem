import { randomUUID } from "node:crypto";
import { AgentMessageReplySchema, AgentMessageRequestSchema, TandemError, type AgentMessage, type AgentMember, type AgentMessageReply } from "@tandem/contracts";
import { type DataStore, gitBlobSha } from "./data/index.ts";
import { assertNoSecrets } from "./context/context.ts";

const DIR = "tandem/agent-messages";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const validLogin = (s: string) => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(s);
export function requirePrivateMessages(separate: boolean): void {
  if (!separate) throw new TandemError("validation", "請先設定獨立的私人團隊資料 repo，再使用訊息與對話分享");
}
const parse = <T>(text: string | null): T | null => { try { return text ? JSON.parse(text) as T : null; } catch { return null; } };
const settingPath = (who: string) => {
  if (!validLogin(who)) throw new TandemError("validation", "GitHub 帳號格式不對");
  return `tandem/agents/${who.toLowerCase()}.json`;
};
async function pushed(store: DataStore, path: string, value: unknown, message: string, createOnly = true, expectVersion?: string | null) {
  const content = JSON.stringify(value, null, 2) + "\n";
  assertNoSecrets(content);
  const r = await store.write([{ path, content, createOnly, ...(expectVersion !== undefined ? { expectVersion } : {}) }], message);
  if (r.result === "conflict") throw new TandemError("conflict", "資料已改變，請重新讀取後再試");
  return r;
}
export async function advertiseAgent(store: DataStore, project: string, me: string, enabled: boolean) {
  const path = settingPath(me);
  const before = await store.read(path);
  const old = parse<{ projects?: Record<string, { enabled: boolean }> }>(before);
  return pushed(store, path, { version: 1, projects: { ...old?.projects, [project]: { enabled } } }, "tandem: update own agent availability", false, before ? gitBlobSha(Buffer.from(before)) : null);
}
export async function agentMembers(store: DataStore, project: string): Promise<AgentMember[]> {
  const result: AgentMember[] = [];
  for (const e of await store.tree("tandem/agents")) {
    const m = /^tandem\/agents\/([A-Za-z0-9-]+)\.json$/.exec(e.path);
    if (!m) continue;
    const data = parse<{ projects?: Record<string, { enabled?: boolean }> }>(await store.read(e.path));
    if (data?.projects?.[project]) result.push({ login: m[1]!, enabled: data.projects[project]?.enabled === true });
  }
  return result;
}
export async function listAgentMessages(store: DataStore, project: string, me: string): Promise<AgentMessage[]> {
  const out: AgentMessage[] = [];
  for (const e of await store.tree(DIR)) {
    if (!/^tandem\/agent-messages\/[0-9a-f-]{36}\/request\.json$/.test(e.path)) continue;
    const request = AgentMessageRequestSchema.safeParse(parse(await store.read(e.path)));
    if (!request.success || request.data.project !== project || e.path !== `${DIR}/${request.data.id}/request.json`) continue;
    const req = request.data;
    if (!same(req.from, me) && !same(req.to, me)) continue;
    const base = `${DIR}/${req.id}`;
    const rep = AgentMessageReplySchema.safeParse(parse(await store.read(`${base}/reply.json`)));
    const reply = rep.success && rep.data.id === req.id && same(rep.data.by, req.to) ? rep.data : undefined;
    // Stored contents remain untrusted; a malformed or secret-bearing record is never exposed.
    try { assertNoSecrets(req.text); if (reply) assertNoSecrets(reply.text); } catch { continue; }
    out.push({ request: req, ...(reply ? { reply } : {}),
      stopped: (await store.read(`${base}/stop-${req.from.toLowerCase()}.json`)) !== null || (await store.read(`${base}/stop-${req.to.toLowerCase()}.json`)) !== null,
      archived: (await store.read(`${base}/archive-${me.toLowerCase()}.json`)) !== null });
  }
  return out.sort((a,b)=>b.request.at.localeCompare(a.request.at));
}
export async function sendAgentMessage(store: DataStore, input: { project: string; me: string; to: string; text: string; separate: boolean }) {
  requirePrivateMessages(input.separate);
  const request = AgentMessageRequestSchema.parse({ id: randomUUID(), project: input.project, from: input.me, to: input.to, text: input.text, at: new Date().toISOString() });
  if (same(request.from, request.to)) throw new TandemError("validation", "請選另一位成員的 agent");
  assertNoSecrets(request.text);
  const member = (await agentMembers(store, input.project)).find(x=>same(x.login,input.to));
  if (!member?.enabled) throw new TandemError("validation", "對方還沒有開放 agent 訊息");
  const write = await pushed(store, `${DIR}/${request.id}/request.json`, request, "tandem: send agent question");
  return { id: request.id, write };
}
export async function replyAgentMessage(store: DataStore, project: string, me: string, id: string, text: string, status: AgentMessageReply["status"] = "answered") {
  const message = (await listAgentMessages(store, project, me)).find(x=>x.request.id===id);
  if (!message || !same(message.request.to,me)) throw new TandemError("validation", "只能回答傳給自己的訊息");
  if (message.stopped || message.reply) return;
  const reply = AgentMessageReplySchema.parse({ id, by: me, text, status, at: new Date().toISOString() });
  const content=JSON.stringify(reply,null,2)+"\n";assertNoSecrets(content);
  return store.write([
    {path:`${DIR}/${id}/reply.json`,content,createOnly:true},
    {path:`${DIR}/${id}/stop-${message.request.from.toLowerCase()}.json`,content:null,expectVersion:null},
    {path:`${DIR}/${id}/stop-${message.request.to.toLowerCase()}.json`,content:null,expectVersion:null},
  ],"tandem: answer agent question");
}
export async function changeAgentMessage(store: DataStore, project: string, me: string, id: string, action: "stop" | "archive") {
  const message = (await listAgentMessages(store, project, me)).find(x=>x.request.id===id);
  if (!message) throw new TandemError("validation", "找不到這則訊息");
  if (action === "stop" && message.reply) return;
  const target = `${DIR}/${id}/${action}-${me.toLowerCase()}.json`;
  if (await store.read(target)) return;
  return pushed(store, target, { at: new Date().toISOString() }, `tandem: ${action} own agent message`);
}
