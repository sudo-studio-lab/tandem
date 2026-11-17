/**
 * Chats with the user's own agent. Kept only on this computer, in
 * <app folder>/chats/<id>.json. Turns adapter events into chat items and pushes updates
 * to the UI; holds approvals until the user clicks.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  TandemError,
  validateChatImages,
  type AgentKind,
  type ApprovalDecision,
  type Chat,
  type ChatItem,
  type ChatSummary,
  type ChatUpdate,
  type ChatImage,
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
  /** A turn finished; `texts` are the assistant messages it produced (rooms post them). */
  onTurnDone?(chat: Chat, texts: string[]): void;
  dir?: string;
}

const now = () => new Date().toISOString();
const summaryOf = ({ items: _items, ...s }: Chat): ChatSummary => s;

export class ChatManager {
  private chats = new Map<string, Chat>();
  private loaded: Promise<void> | null = null;
  private live = new Map<string, Live>();
  private configuring = new Set<string>();
  private generations = new Map<string, number>();
  private queueCwds = new Map<string, string>();
  private draining = new Set<string>();
  private failedTurns = new Set<string>();
  private closing = false;
  private approvals = new Map<string, PendingApproval>();
  /** Every approval's outcome, kept so a bridge call that re-asks after a long wait still gets it. */
  private decisions = new Map<string, Promise<ApprovalDecision>>();
  /** chatId → approval names the user allowed for the whole chat. */
  private allowAll = new Map<string, Set<string>>();
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** chatId → index of the first item of the running turn. */
  private turnStart = new Map<string, number>();
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
          if (c.queue?.length) c.queuePaused = true; // never restart work without a user action
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
      .filter((c) => c.projectId === projectId && !c.room)
      .map(summaryOf)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(chatId: string): Promise<Chat> {
    return this.need(chatId);
  }

  async create(projectId: string, agent: AgentKind, model: string, room?: { number: number; url: string; title: string }): Promise<ChatSummary> {
    await this.load();
    const t = now();
    const chat: Chat = { id: randomUUID(), projectId, agent, model, title: room?.title ?? "新對話", createdAt: t, updatedAt: t, running: false, items: [] };
    if (room) chat.room = { number: room.number, url: room.url };
    this.chats.set(chat.id, chat);
    this.touch(chat);
    return summaryOf(chat);
  }

  async configure(chatId: string, model: string, reasoningEffort?: string): Promise<ChatSummary> {
    const chat = await this.need(chatId);
    if (chat.running || this.configuring.has(chatId) || this.draining.has(chatId)) throw new TandemError("usage", "請等目前的工作完成，再切換模型");
    if (typeof model !== "string" || model.length > 200 || (reasoningEffort !== undefined && !/^[a-z]{1,20}$/.test(reasoningEffort))) throw new TandemError("usage", "模型設定不正確");
    this.configuring.add(chatId);
    try {
      const live = this.live.get(chatId);
      this.live.delete(chatId);
      this.generations.set(chatId, (this.generations.get(chatId) ?? 0) + 1);
      await live?.session.close();
      chat.model = model;
      chat.reasoningEffort = reasoningEffort;
      this.touch(chat);
      return summaryOf(chat);
    } finally {
      this.configuring.delete(chatId);
    }
  }

  async send(chatId: string, text: string, cwd: string, attachments?: unknown, fromQueue = false): Promise<void> {
    const chat = await this.need(chatId);
    const body = text.trim();
    const images = validateChatImages(attachments);
    if (!body && !images.length) throw new TandemError("usage", "訊息是空的");
    if (this.configuring.has(chatId)) throw new TandemError("usage", "正在切換模型，請稍候");
    if (!fromQueue && this.draining.has(chatId)) throw new TandemError("usage", "正在送出待處理訊息，請排入下一則");
    if (chat.running) throw new TandemError("usage", "agent 還在回覆，請等它做完或按停止");
    if (chat.items.length === 0 || chat.title === "新對話") chat.title = body.replace(/\s+/g, " ").slice(0, 40) || images[0]!.name || "圖片";
    this.upsert(chat, { kind: "user", id: randomUUID(), at: now(), text: body, ...(images.length ? { images } : {}) });
    await this.sendToAgent(chat.id, body, cwd, images);
  }

  async steer(chatId: string, text: string, attachments?: unknown): Promise<void> {
    const chat = await this.need(chatId);
    const images = validateChatImages(attachments);
    const body = text.trim();
    if (!body && !images.length) throw new TandemError("usage", "訊息是空的");
    const live = this.live.get(chatId);
    if (!chat.running || !live?.session.steer) throw new TandemError("usage", "這個 provider 目前無法即時補充，請排入下一則");
    await live.session.steer(body, images);
    this.upsert(chat, { kind: "user", id: randomUUID(), at: now(), text: body, ...(images.length ? { images } : {}) });
    this.touch(chat);
  }

  async enqueue(chatId: string, text: string, cwd: string, attachments?: unknown): Promise<void> {
    const chat = await this.need(chatId);
    const images = validateChatImages(attachments);
    const body = text.trim();
    if (!body && !images.length) throw new TandemError("usage", "訊息是空的");
    if ((chat.queue?.length ?? 0) >= 20) throw new TandemError("usage", "待處理訊息已達 20 則，請先處理或移除");
    (chat.queue ??= []).push({ id: randomUUID(), text: body, images, at: now() });
    this.queueCwds.set(chatId, cwd);
    this.touch(chat);
    void this.drain(chatId);
  }

  async updateQueued(chatId: string, id: string, update?: { text: string; images?: unknown }): Promise<void> {
    const chat = await this.need(chatId);
    const queued = chat.queue?.find((q) => q.id === id);
    if (!queued) throw new TandemError("usage", "這則訊息已送出或移除");
    if (update) {
      const images = validateChatImages(update.images);
      if (!update.text.trim() && !images.length) throw new TandemError("usage", "訊息是空的");
      queued.text = update.text.trim(); queued.images = images;
    } else chat.queue = chat.queue!.filter((q) => q.id !== id);
    this.touch(chat);
  }

  async resumeQueue(chatId: string, cwd: string): Promise<void> {
    const chat = await this.need(chatId);
    chat.queuePaused = false;
    this.queueCwds.set(chatId, cwd);
    this.touch(chat);
    void this.drain(chatId);
  }

  private async drain(chatId: string): Promise<void> {
    if (this.closing || this.draining.has(chatId)) return;
    this.draining.add(chatId);
    try {
      const chat = await this.need(chatId);
      const cwd = this.queueCwds.get(chatId);
      if (!cwd || chat.running || chat.queuePaused || this.configuring.has(chatId)) return;
      const next = chat.queue?.shift();
      if (!next) return;
      this.touch(chat);
      try { await this.send(chatId, next.text, cwd, next.images, true); }
      catch (e) {
        chat.queue!.unshift(next); chat.queuePaused = true;
        this.upsert(chat, { kind: "error", id: randomUUID(), at: now(), message: "待處理訊息未能送出，已暫停佇列", detail: (e as Error).message });
        this.touch(chat);
      }
    } catch { /* A chat may have been deleted while the drain was scheduled. */ }
    finally {
      this.draining.delete(chatId);
      const chat = this.chats.get(chatId);
      if (chat && !chat.running && !chat.queuePaused && chat.queue?.length && !this.closing && this.queueCwds.has(chatId) && !this.configuring.has(chatId)) queueMicrotask(() => void this.drain(chatId));
    }
  }

  /** The room chat that answers discussion `number`, if this computer hosts it. */
  async findRoom(projectId: string, number: number): Promise<Chat | undefined> {
    await this.load();
    return [...this.chats.values()].find((c) => c.projectId === projectId && c.room?.number === number);
  }

  /** Show an item without sending anything to the agent (room messages, notices). */
  async addItem(chatId: string, item: ChatItem): Promise<void> {
    const chat = await this.need(chatId);
    this.upsert(chat, item);
    this.touch(chat);
  }

  /** Send text to the agent without adding a user item (rooms add their own, with the author). */
  async sendToAgent(chatId: string, body: string, cwd: string, images: ChatImage[] = []): Promise<void> {
    const chat = await this.need(chatId);
    if (chat.running) throw new TandemError("usage", "agent 還在回覆，請等它做完或按停止");
    if (this.configuring.has(chatId)) throw new TandemError("usage", "正在切換模型，請稍候");
    chat.running = true;
    this.failedTurns.delete(chatId);
    this.turnStart.set(chat.id, chat.items.length);
    this.touch(chat);
    try {
      await this.session(chat, cwd).send(body, images);
    } catch (e) {
      chat.running = false;
      chat.queuePaused = true;
      this.upsert(chat, { kind: "error", id: randomUUID(), at: now(), message: "沒辦法啟動 agent", detail: (e as Error).message });
      this.touch(chat);
    }
  }

  async interrupt(chatId: string): Promise<void> {
    const chat = await this.need(chatId);
    chat.queuePaused = true;
    this.touch(chat);
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
    this.closing = true;
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
    const generation = (this.generations.get(chat.id) ?? 0) + 1;
    this.generations.set(chat.id, generation);
    const session = adapter.start({
      chatId: chat.id,
      cwd,
      model: chat.model,
      reasoningEffort: chat.reasoningEffort,
      resumeId: chat.agentSessionId,
      mcp: this.opts.mcp(),
      approveBridge: chat.agent === "claude" ? this.opts.approveBridge() : undefined,
      requestApproval: async (req) => (await this.requestApproval(chat.id, req)).decision,
      onEvent: (e) => {
        if (this.generations.get(chat.id) === generation) this.onEvent(chat.id, e);
      },
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
        this.upsert(chat, { kind: "assistant", id, at: it?.at ?? now(), text: e.text, ...(it?.kind === "assistant" && it.images ? { images: it.images } : {}), streaming: false });
        return;
      }
      case "image": {
        const id = `a:${e.id}`;
        const previous = chat.items.find((item) => item.id === id);
        try {
          const images = validateChatImages([...(previous?.kind === "assistant" ? previous.images ?? [] : []), e.image]);
          this.upsert(chat, { kind: "assistant", id, at: previous?.at ?? now(), text: previous?.kind === "assistant" ? previous.text : "", images, streaming: true });
        } catch {
          this.upsert(chat, { kind: "notice", id: randomUUID(), at: now(), text: "Provider 回傳的圖片格式或大小無法直接顯示。" });
        }
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
      case "turnDone": {
        chat.running = false;
        if (this.failedTurns.has(chatId)) chat.queuePaused = true;
        if (e.costUsd !== undefined) chat.costUsd = (chat.costUsd ?? 0) + e.costUsd;
        this.finishStreaming(chat);
        this.touch(chat);
        const from = this.turnStart.get(chatId) ?? chat.items.length;
        this.turnStart.delete(chatId);
        const texts = chat.items.slice(from).flatMap((it) => (it.kind === "assistant" && it.text.trim() ? [it.text] : []));
        this.opts.onTurnDone?.(chat, texts);
        void this.drain(chatId);
        return;
      }
      case "error":
        this.failedTurns.add(chatId);
        this.upsert(chat, { kind: "error", id: randomUUID(), at: now(), message: e.message, detail: e.detail });
        return;
      case "exit":
        this.live.delete(chatId);
        for (const [id, a] of this.approvals) if (a.chatId === chatId) this.settle(id, "deny", "agent 已經結束");
        if (chat.running) {
          chat.running = false;
          chat.queuePaused = true;
          this.finishStreaming(chat);
          this.touch(chat);
        }
        return;
    }
  }
}
