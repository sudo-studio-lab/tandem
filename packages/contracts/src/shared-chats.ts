import { z } from "zod";
export const SharedChatSchema=z.object({
  id:z.string().regex(/^[a-f0-9]{64}$/),project:z.string(),owner:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/),
  source:z.enum(["claude","codex","tandem"]),title:z.string().max(160),sharedAt:z.string().datetime(),
  messages:z.array(z.object({role:z.enum(["user","assistant"]),text:z.string().max(24000)})).max(100),
});
export type SharedChat=z.infer<typeof SharedChatSchema> & {version?:string};
export interface SharedChatSettings{enabled:boolean;transcriptIds:string[];lastError?:string}
export interface Handoff{id:string;project:string;task:number;from:string;to:string;note:string;at:string}
