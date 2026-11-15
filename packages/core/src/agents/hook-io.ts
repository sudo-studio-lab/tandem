/**
 * Hook input parsing and output formatting for Claude Code and Codex.
 * Formats verified against:
 *   https://code.claude.com/docs/en/hooks
 *   https://learn.chatgpt.com/docs/hooks
 */

export type AgentName = "claude" | "codex";
export type HookEvent = "session-start" | "stop" | "user-prompt" | "post-compact";

export interface HookInput {
  sessionId?: string;
  source?: string;
  stopHookActive?: boolean;
  lastAssistantMessage?: string;
  raw: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Tolerant parser for the JSON both agents send on stdin. Never throws. */
export function readHookInput(stdinText: string): HookInput {
  const text = (stdinText ?? "").replace(/^\uFEFF/, "").trim();
  if (!text) return { raw: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { raw: null };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { raw };
  const o = raw as Record<string, unknown>;
  const out: HookInput = { raw };
  const sessionId = str(o.session_id) ?? str(o.sessionId);
  if (sessionId !== undefined) out.sessionId = sessionId;
  const source = str(o.source);
  if (source !== undefined) out.source = source;
  const active = o.stop_hook_active ?? o.stopHookActive;
  if (typeof active === "boolean") out.stopHookActive = active;
  const last = str(o.last_assistant_message) ?? str(o.lastAssistantMessage);
  if (last !== undefined) out.lastAssistantMessage = last;
  return out;
}

/**
 * The exact JSON each agent expects on stdout (always a single JSON object).
 * - session-start / user-prompt: hookSpecificOutput.additionalContext (same shape on both agents)
 * - stop: {"decision":"block","reason":...} continues the agent; "{}" allows it (Codex rejects plain text)
 * - post-compact: Codex ignores plain text and accepts only common JSON fields, so always "{}"
 */
export function formatHookOutput(
  agent: AgentName,
  event: HookEvent,
  payload: { context?: string; blockReason?: string },
): string {
  void agent; // both agents currently share one shape; kept in the signature for divergence
  switch (event) {
    case "session-start":
    case "user-prompt": {
      if (!payload.context) return "{}";
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: event === "session-start" ? "SessionStart" : "UserPromptSubmit",
          additionalContext: payload.context,
        },
      });
    }
    case "stop":
      return payload.blockReason
        ? JSON.stringify({ decision: "block", reason: payload.blockReason })
        : "{}";
    case "post-compact":
      return "{}";
  }
}
