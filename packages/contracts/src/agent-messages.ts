import { z } from "zod";

const login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/);
export const AgentMessageRequestSchema = z.object({
  id: z.string().uuid(), project: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  from: login, to: login, text: z.string().trim().min(1).max(8000), at: z.string().datetime(),
});
export type AgentMessageRequest = z.infer<typeof AgentMessageRequestSchema>;
export const AgentMessageReplySchema = z.object({
  id: z.string().uuid(), by: login, text: z.string().max(24000), at: z.string().datetime(),
  status: z.enum(["answered", "failed"]),
});
export type AgentMessageReply = z.infer<typeof AgentMessageReplySchema>;
export interface AgentMessage {
  request: AgentMessageRequest;
  reply?: AgentMessageReply;
  stopped: boolean;
  archived: boolean;
}
export interface AgentMessageSettings {
  enabled: boolean;
  provider: "claude" | "codex";
  model: string;
  effort?: string;
  transcriptIds: string[];
}
export interface AgentMember { login: string; enabled: boolean }
export interface ProjectTranscript {
  id: string;
  source: "claude" | "codex" | "tandem";
  title: string;
  updatedAt: string;
  messages: { role: "user" | "assistant"; text: string }[];
}
