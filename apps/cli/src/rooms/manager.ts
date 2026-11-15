/**
 * Rooms: several teammates talk with one agent that runs on the host's computer.
 * The room is a GitHub Discussion: everyone's messages are comments (so each line has an author
 * and a URL), the AI's replies are comments starting with 🤖, and the meeting notes are the body.
 * The host's app polls the discussion, feeds new messages to a local chat (ChatManager), and
 * posts the agent's replies back. Guests only read and comment.
 */
import { randomUUID } from "node:crypto";
import { TandemError, type AgentKind, type Chat, type Room, type RoomRef } from "@tandem/contracts";
import type { GitHubClient } from "@tandem/core";
import type { ChatManager } from "../chats/manager.ts";

export interface RoomProject {
  gh: Pick<GitHubClient, "createRoom" | "listRooms" | "getRoom" | "commentOnRoom" | "setRoomNotes" | "closeDiscussion">;
  me: string;
  cwd: string;
}

interface Incoming {
  by: string;
  text: string;
  url: string;
}

interface Hosted {
  projectId: string;
  number: number;
  chatId: string;
  /** Comment URLs already shown in the chat. */
  seen: Set<string> | null;
  /** Messages shown but not yet sent to the agent (it was busy). */
  queue: Incoming[];
  timer: ReturnType<typeof setInterval>;
  polling: boolean;
  /** The running turn writes the notes instead of a reply; "end" also closes the room. */
  notes: "notes" | "end" | null;
}

export const POLL_MS = 4000;
const isAiComment = (body: string) => /^\s*🤖/.test(body);
const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function intro(host: string): string {
  return [
    `（Tandem 房間：好幾位隊友一起跟你對話，你跑在 @${host} 的電腦上。每則訊息開頭標了說話的人和那則留言的網址。`,
    "回答時需要就點名是誰。大家做出會影響團隊的決定時，用 tandem_decide 先產生草稿給大家確認：原話逐字引用說話的人，by 填他的帳號，source 填那則留言的網址。）",
  ].join("");
}

const NOTES_PROMPT = [
  "請把到目前為止房間裡的討論整理成會議筆記（Markdown），只輸出筆記本身，不要開場白或其他說明。",
  "依序用這些段落：## 重點、## 決定（每筆附上是誰說的和原話）、## 待辦（誰做什麼）、## 還沒解決的問題。沒有內容的段落就省略。",
].join("");

export class RoomManager {
  private hosted = new Map<string, Hosted>();

  constructor(
    private o: {
      chats: ChatManager;
      project(projectId: string): Promise<RoomProject>;
      agentLabel(kind: AgentKind): string;
      pollMs?: number;
    },
  ) {}

  async list(projectId: string): Promise<RoomRef[]> {
    return (await this.o.project(projectId)).gh.listRooms();
  }

  async create(projectId: string, title: string, agent: AgentKind, model: string): Promise<Room> {
    const p = await this.o.project(projectId);
    const t = title.trim().replace(/\s+/g, " ").slice(0, 80) || "房間";
    const ref = await p.gh.createRoom(t, p.me);
    const chat = await this.o.chats.create(projectId, agent, model, { number: ref.number, url: ref.url, title: t });
    this.host(projectId, ref.number, chat.id);
    return this.get(projectId, ref.number);
  }

  async get(projectId: string, number: number): Promise<Room> {
    const p = await this.o.project(projectId);
    const d = await p.gh.getRoom(number);
    const room: Room = {
      number: d.number,
      url: d.url,
      title: d.title,
      host: d.host,
      closed: d.closed,
      updatedAt: d.updatedAt,
      notes: d.notes,
      messages: d.comments.map((c) => {
        const ai = sameLogin(c.by, d.host) && isAiComment(c.body);
        return { id: c.id, by: c.by, text: ai ? c.body.replace(/^\s*🤖[^\n]*\n+/, "") : c.body, url: c.url, at: c.at, ai };
      }),
    };
    if (sameLogin(d.host, p.me)) {
      const chat = await this.o.chats.findRoom(projectId, number);
      if (chat) {
        room.chatId = chat.id;
        room.running = chat.running;
        if (!d.closed) this.host(projectId, number, chat.id);
      }
    }
    return room;
  }

  async post(projectId: string, number: number, text: string): Promise<void> {
    const body = text.trim().replace(/^🤖\s*/, "");
    if (!body) throw new TandemError("usage", "訊息是空的");
    const p = await this.o.project(projectId);
    const c = await p.gh.commentOnRoom(number, body);
    const h = this.hosted.get(key(projectId, number));
    if (h) {
      await this.ingest(h, { by: p.me, text: body, url: c.url });
      await this.pump(h);
    }
  }

  /** Host only: ask the AI for meeting notes (and close the room when `end`). */
  async notes(projectId: string, number: number, end: boolean): Promise<void> {
    const h = this.hosted.get(key(projectId, number));
    if (!h) throw new TandemError("usage", "只有主持人的電腦能整理筆記和結束房間");
    const chat = await this.o.chats.get(h.chatId);
    if (chat.running) throw new TandemError("usage", "AI 還在回覆，等它說完再試");
    // Anything still waiting goes in first, so the notes cover it.
    const pending = h.queue.splice(0);
    h.notes = end ? "end" : "notes";
    await this.o.chats.addItem(h.chatId, { kind: "notice", id: randomUUID(), at: new Date().toISOString(), text: end ? "結束房間：AI 正在整理筆記…" : "AI 正在整理筆記…" });
    const head = pending.length ? `${format(pending)}\n\n` : "";
    await this.o.chats.sendToAgent(h.chatId, head + NOTES_PROMPT, (await this.o.project(projectId)).cwd);
  }

  /** ChatManager hook: a turn of some chat finished. */
  onTurnDone(chat: Chat, texts: string[]): void {
    if (!chat.room) return;
    const h = this.hosted.get(key(chat.projectId, chat.room.number));
    if (!h) return;
    void (async () => {
      const p = await this.o.project(h.projectId);
      const mode = h.notes;
      h.notes = null;
      const text = texts.join("\n\n").trim();
      try {
        if (mode) {
          if (text) await p.gh.setRoomNotes(h.number, p.me, text);
          if (mode === "end") {
            await p.gh.commentOnRoom(h.number, `🤖 ${this.o.agentLabel(chat.agent)}：\n\n房間已結束，筆記在最上面。`);
            await p.gh.closeDiscussion(h.number, "RESOLVED");
            this.stop(h);
            await this.o.chats.addItem(h.chatId, { kind: "notice", id: randomUUID(), at: new Date().toISOString(), text: "房間已結束，筆記已存到 GitHub。" });
            return;
          }
          await this.o.chats.addItem(h.chatId, { kind: "notice", id: randomUUID(), at: new Date().toISOString(), text: "筆記已更新。" });
        } else if (text) {
          await p.gh.commentOnRoom(h.number, `🤖 ${this.o.agentLabel(chat.agent)}：\n\n${text}`);
        }
      } catch (e) {
        await this.o.chats
          .addItem(h.chatId, { kind: "error", id: randomUUID(), at: new Date().toISOString(), message: "沒辦法把 AI 的回覆送到房間", detail: (e as Error).message })
          .catch(() => undefined);
      }
      await this.pump(h);
    })();
  }

  closeAll(): void {
    for (const h of this.hosted.values()) clearInterval(h.timer);
    this.hosted.clear();
  }

  // --- host side ------------------------------------------------------------------
  private host(projectId: string, number: number, chatId: string): void {
    const k = key(projectId, number);
    if (this.hosted.has(k)) return;
    const h: Hosted = { projectId, number, chatId, seen: null, queue: [], polling: false, notes: null, timer: setInterval(() => void this.poll(h), this.o.pollMs ?? POLL_MS) };
    h.timer.unref?.();
    this.hosted.set(k, h);
    void this.poll(h);
  }

  private stop(h: Hosted): void {
    clearInterval(h.timer);
    this.hosted.delete(key(h.projectId, h.number));
  }

  /** Visible for tests: one sync round. */
  async poll(h: Hosted | { projectId: string; number: number }): Promise<void> {
    const hh = "chatId" in h ? h : this.hosted.get(key(h.projectId, h.number));
    if (!hh || hh.polling) return;
    hh.polling = true;
    try {
      const p = await this.o.project(hh.projectId);
      const d = await p.gh.getRoom(hh.number);
      if (d.closed) {
        this.stop(hh);
        return;
      }
      for (const c of d.comments) {
        if (sameLogin(c.by, d.host) && isAiComment(c.body)) continue;
        await this.ingest(hh, { by: c.by, text: c.body, url: c.url });
      }
      await this.pump(hh);
    } catch {
      /* offline or rate-limited: try again next round */
    } finally {
      hh.polling = false;
    }
  }

  private async ingest(h: Hosted, m: Incoming): Promise<void> {
    if (!h.seen) {
      const chat = await this.o.chats.get(h.chatId);
      h.seen = new Set(chat.items.flatMap((it) => (it.kind === "user" && it.url ? [it.url] : [])));
    }
    if (h.seen.has(m.url)) return;
    h.seen.add(m.url);
    h.queue.push(m);
    await this.o.chats.addItem(h.chatId, { kind: "user", id: randomUUID(), at: new Date().toISOString(), text: m.text, by: m.by, url: m.url });
  }

  /** Send queued messages to the agent when it is free. */
  private async pump(h: Hosted): Promise<void> {
    if (!h.queue.length || h.notes) return;
    const chat = await this.o.chats.get(h.chatId);
    if (chat.running) return;
    const batch = h.queue.splice(0);
    const p = await this.o.project(h.projectId);
    const first = !chat.agentSessionId && !chat.items.some((it) => it.kind === "assistant");
    await this.o.chats.sendToAgent(h.chatId, (first ? `${intro(p.me)}\n\n` : "") + format(batch), p.cwd);
  }
}

const key = (projectId: string, number: number) => `${projectId}#${number}`;
const format = (ms: Incoming[]) => ms.map((m) => `@${m.by}（${m.url}）：\n${m.text}`).join("\n\n");
