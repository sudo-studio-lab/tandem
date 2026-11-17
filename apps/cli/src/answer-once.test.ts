import {expect,it,vi} from "vitest";
import {answerOnce} from "./agent-messages.ts";
import type{AgentAdapter,StartOptions}from "./agents/types.ts";
it("accepts read-tool completion events without names, denies permissions, and closes on cancellation",async()=>{
 let options:StartOptions|undefined;const close=vi.fn(async()=>{});
 const adapter:AgentAdapter={kind:"codex",status:async()=>({} as any),login:async()=>({message:""}),logout:async()=>{},start:o=>{options=o;return {send:async()=>{o.onEvent({type:"tool",id:"t",name:"mcp__tandem__tandem_decisions",summary:"",status:"running"});o.onEvent({type:"tool",id:"t",name:"",summary:"",status:"done"});o.onEvent({type:"message",id:"m",text:"Answer"});o.onEvent({type:"turnDone"});},interrupt:async()=>{},close};}};
 const base={cwd:"/empty",model:"test",mcp:{command:"node",args:[],env:{}},bundle:"question",signal:new AbortController().signal};
 expect(await answerOnce(adapter,base)).toBe("Answer");expect(options?.answerOnly).toBeDefined();expect(await options?.requestApproval({name:"Write",summary:""})).toBe("deny");expect(close).toHaveBeenCalled();
 const controller=new AbortController();adapter.start=o=>{options=o;return {send:async()=>{},interrupt:async()=>{},close};};const running=answerOnce(adapter,{...base,signal:controller.signal});controller.abort();await expect(running).rejects.toThrow("已停止");
});
