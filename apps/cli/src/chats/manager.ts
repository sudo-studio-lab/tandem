/**
 * Chats with the user's own agent (spec 003 情境 1). Kept only on this computer, in
 * <app folder>/chats/<id>.json (FR-008). Turns adapter events into chat items and pushes updates
 * to the UI; holds approvals until the user clicks.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  TandemError,
  type AgentKind,
  type ApprovalDecision,
  type Chat,
  type ChatItem,
  type ChatSummary,
  type ChatUpdate,
} from "@tandem/contracts";
import { appStateDir } from "@tandem/core";
import type { AdapterEvent, AgentAdapter, AgentSession, ApprovalRequest, McpLaunch } from "../agents/types.ts";

interface PendingApproval {
  chatId: string;
  name: string;
  resolve(d: ApprovalDecision): void;
  promise: Promise<ApprovalDecision>;
}

interface Live {
  session: AgentSession;
  cwd: string;
}

export interface ChatManagerOptions {
  adapters: Record<AgentKind, AgentAdapter>;
  emit(u: ChatUpdate): void;
  mcp(): McpLaunch;
  /** Claude's approve bridge; undefined until the server knows its port. */
  approveBridge(): { url: string; token: string } | undefined;
  dir?: string;
}

const now = () => new Date().toISOString();
const summaryOf = ({ items: _items, ...s }: Chat): ChatSummary => s;

export class ChatManager {
  private chats = new Map<string, Chat>();
  private loaded: Promise<void> | null = null;
  private live = new Map<string, Live>();
  private approvals = new Map<string, PendingApproval>();
  /** Every approval's outcome, kept so a bridge call that re-asks after a long wait still gets it. */
  private decisions = new Map<string, Promise<ApprovalDecision>>();
  /** chatId → approval names the user allowed for the whole chat. */
  private allowAll = new Map<string, Set<string>>();
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly dir: string;

  constructor(private opts: ChatManagerOptions) {
    this.dir = opts.dir ?? path.join(appStateDir(), "chats");
  }

  // --- storage ----------------------------------------------------------------
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      await mkdir(this.dir, { recursive: true });
      for (const f of await readdir(this.dir)) {
        if (!/^[\w-]+\.json$/.test(f) || f.endsWith(".mcp.json")) continue;
        try {
          const c = JSON.parse(await readFile(path.join(this.dir, f), "utf8")) as Chat;
          c.running = false; // nothing survives a restart
          for (const it of c.items) {
            if (it.kind === "assistant") it.streaming = false;
            if (it.kind === "tool" && it.status === "running") it.status = "error";
            if (it.kind === "approval" && it.state === "pending") Object.assign(it, { state: "denied", note: "程式重新啟動，沒有執行" });
          }
          this.chats.set(c.id, c);
        } catch {
          /* unreadable file: skip it */
        }
      }
    })();
    return this.loaded;
  }

  private scheduleSave(chat: Chat) {
    clearTimeout(this.saveTimers.get(chat.id));
    this.saveTimers.set(
      chat.id,
      setTimeout(() => {
        this.saveTimers.delete(chat.id);
        void writeFile(path.join(this.dir, `${chat.id}.json`), JSON.stringify(chat), "utf8").catch(() => undefined);
      }, 400),
    );
  }

  async flush(): Promise<void> {
    for (const [id, t] of this.saveTimers) {
      clearTimeout(t);
      const c = this.chats.get(id);
      if (c) await writeFile(path.join(this.dir, `${id}.json`), JSON.stringify(c), "utf8").catch(() => undefined);
    }
    this.saveTimers.clear();
  }

  private async need(chatId: string): Promise<Chat> {
    await this.load();
    const c = this.chats.get(chatId);
    if (!c) throw new TandemError("usage", "找不到這段對話");
    return c;
  }

  private touch(chat: Chat) {
    chat.updatedAt = now();
    this.opts.emit({ chatId: chat.id, type: "summary", chat: summaryOf(chat) });
    this.scheduleSave(chat);
  }

  private upsert(chat: Chat, item: ChatItem) {
    const i = chat.items.findIndex((x) => x.id === item.id);
    if (i >= 0) chat.items[i] = item;
    else chat.items.push(item);
    this.opts.emit({ chatId: chat.id, type: "item", item });
    this.scheduleSave(chat);
  }

  // --- API ----------------------------------------------------------------------
  async list(projectId: string): Promise<ChatSummary[]> {
    await this.load();
    return [...this.chats.values()]
      .filter((c) => c.projectId === projectId)
      .map(summaryOf)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(chatId: string): Promise<Chat> {
    return this.need(chatId);
  }

  async create(projectId: string, agent: AgentKind, model: string): Promise<ChatSummary> {
    await this.load();
    const t = now();
    const chat: Chat = { id: randomUUID(), projectId, agent, model, title: "新對話", createdAt: t, updatedAt: t, running: false, items: [] };
    this.chats.set(chat.id, chat);
    this.touch(chat);
    return summaryOf(chat);
  }

  async send(chatId: string, text: string, cwd: string): Promise<void> {
    const chat = await this.need(chatId);
    const body = text.trim();
    if (!body) throw new TandemError("usage", "訊息是空的");
    if (chat.running) throw new TandemError("usage", "agent 還在回覆，請等它做完或按停止");
    if (chat.items.length === 0 || chat.title === "新對話") chat.title = body.replace(/\s+/g, " ").slice(0, 40);
    this.upsert(chat, { kind: "user", id: randomUUID(), at: now(), text: body });
    chat.running = true;
    this.touch(chat);
    try {
      await this.session(chat, cwd).send(body);
    } catch (e) {
      chat.running = false;
      this.upsert(chat, { kind: "error", id: randomUUID(), at: now(), message: "沒辦法啟動 agent", detail: (e as Error).message });
      this.touch(chat);
    }
  }

  async interrupt(chatId: string): Promise<void> {
    const chat = await this.need(chatId);
    const wasRunning = chat.running;
    for (const [id, a] of this.approvals) if (a.chatId === chatId) this.settle(id, "deny", "已停止");
    const live = this.live.get(chatId);
    if (live) await live.session.interrupt();
    if (wasRunning) {
      chat.running = false;
      this.finishStreaming(chat);
      this.upsert(chat, { kind: "notice", id: randomUUID(), at: now(), text: "已停止。已經做的修改都留著，你可以接著說。" });
      this.touch(chat);
    }
  }

  async answer(chatId: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
    const a = this.approvals.get(approvalId);
    if (!a || a.chatId !== chatId) throw new TandemError("usage", "這個核准已經處理過了");
    if (decision === "allowSession") {
      const set = this.allowAll.get(chatId) ?? new Set<string>();
      set.add(a.name);
      this.allowAll.set(chatId, set);
    }
    this.settle(approvalId, decision);
  }

  async remove(chatId: string): Promise<void> {
    await this.need(chatId);
    await this.interrupt(chatId).catch(() => undefined);
    const live = this.live.get(chatId);
    this.live.delete(chatId);
    await live?.session.close().catch(() => undefined);
    clearTimeout(this.saveTimers.get(chatId));
    this.saveTimers.delete(chatId);
    this.chats.delete(chatId);
    await rm(path.join(this.dir, `${chatId}.json`), { force: true });
    this.opts.emit({ chatId, type: "deleted" });
  }

  async closeAll(): Promise<void> {
    for (const l of this.live.values()) await l.session.close().catch(() => undefined);
    this.live.clear();
    await this.flush();
  }

  /**
   * An agent wants to do something that needs the user's OK. Returns the approval id right away
   * plus a promise for the decision (the HTTP bridge waits on it in slices).
   */
  async requestApproval(chatId: string, req: ApprovalRequest): Promise<{ id: string; decision: Promise<ApprovalDecision> }> {
    const chat = await this.need(chatId);
    const id = randomUUID();
    const base = { kind: "approval" as const, id, at: now(), name: req.name, summary: req.summary, input: req.input };
    if (this.allowAll.get(chatId)?.has(req.name)) {
      this.upsert(chat, { ...base, state: "allowed", note: "這段對話都同意" });
      this.decisions.set(id, Promise.resolve("allow"));
      return { id, decision: Promise.resolve("allow") };
    }
    let resolve!: (d: ApprovalDecision) => void;
    const promise = new Promise<ApprovalDecision>((r) => (resolve = r));
    this.approvals.set(id, { chatId, name: req.name, resolve, promise });
    this.decisions.set(id, promise);
    this.upsert(chat, { ...base, state: "pending" });
    return { id, decision: promise };
  }

  /** Still waiting on this approval? (The bridge re-asks after long waits.) */
  pendingApproval(id: string): Promise<ApprovalDecision> | undefined {
    return this.decisions.get(id);
  }

  private settle(approvalId: string, decision: ApprovalDecision, note?: string) {
    const a = this.approvals.get(approvalId);
    if (!a) return;
    this.approvals.delete(approvalId);
    const chat = this.chats.get(a.chatId);
    const item = chat?.items.find((x) => x.id === approvalId);
    if (chat && item?.kind === "approval") {
      this.upsert(chat, { ...item, state: decision === "deny" ? "denied" : "allowed", ...(note ? { note } : decision === "allowSession" ? { note: "這段對話都同意" } : {}) });
    }
    a.resolve(decision);
  }

  // --- agent sessions ------------------------------------------------------------
  private session(chat: Chat, cwd: string): AgentSession {
    const existing = this.live.get(chat.id);
    if (existing && existing.cwd === cwd) return existing.session;
    const adapter = this.opts.adapters[chat.agent];
    const session = adapter.start({
      chatId: chat.id,
      cwd,
      model: chat.model,
      resumeId: chat.agentSessionId,
      mcp: this.opts.mcp(),
      approveBridge: chat.agent === "claude" ? this.opts.approveBridge() : undefined,
      requestApproval: async (req) => (await this.requestApproval(chat.id, req)).decision,
      onEvent: (e) => this.onEvent(chat.id, e),
    });
    this.live.set(chat.id, { session, cwd });
    return session;
  }

  private finishStreaming(chat: Chat) {
    for (const it of chat.items) {
      if (it.kind === "assistant" && it.streaming) this.upsert(chat, { ...it, streaming: false });
    }
  }

  private onEvent(chatId: string, e: AdapterEvent) {
    const chat = this.chats.get(chatId);
    if (!chat) return;
    switch (e.type) {
      case "session":
        chat.agentSessionId = e.agentSessionId;
        this.touch(chat);
        return;
      case "text": {
        const id = `a:${e.id}`;
        const it = chat.items.find((x) => x.id === id);
        if (!it) this.upsert(chat, { kind: "assistant", id, at: now(), text: e.delta, streaming: true });
        else if (it.kind === "assistant") {
          it.text += e.delta;
          this.opts.emit({ chatId, type: "delta", itemId: id, text: e.delta });
          this.scheduleSave(chat);
        }
        return;
      }
      case "message": {
        const id = `a:${e.id}`;
        const it = chat.items.find((x) => x.id === id);
        if (!e.text.trim() && !it) return;
        this.upsert(chat, { kind: "assistant", id, at: it?.at ?? now(), text: e.text, streaming: false });
        return;
      }
      case "tool": {
        const id = `t:${e.id}`;
        const it = chat.items.find((x) => x.id === id);
        const prev = it?.kind === "tool" ? it : undefined;
        this.upsert(chat, {
          kind: "tool",
          id,
          at: prev?.at ?? now(),
          name: e.name || prev?.name || "工具",
          summary: e.summary || prev?.summary || "",
          input: e.input ?? prev?.input,
          status: e.status,
          output: e.output ?? prev?.output,
        });
        return;
      }
      case "turnDone":
        chat.running = false;
        if (e.costUsd !== undefined) chat.costUsd = (chat.costUsd ?? 0) + e.costUsd;
        this.finishStreaming(chat);
        this.touch(chat);
        return;
      case "error":
        this.upsert(chat, { kind: "error", id: randomUUID(), at: now(), message: e.message, detail: e.detail });
        return;
      case "exit":
        this.live.delete(chatId);
        for (const [id, a] of this.approvals) if (a.chatId === chatId) this.settle(id, "deny", "agent 已經結束");
        if (chat.running) {
          chat.running = false;
          this.finishStreaming(chat);
          this.touch(chat);
        }
        return;
    }
  }
}
