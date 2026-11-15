import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoomData } from "@tandem/core";
import type { AgentAdapter, StartOptions } from "../agents/types.ts";
import { ChatManager } from "../chats/manager.ts";
import { RoomManager, type RoomProject } from "./manager.ts";

/** An in-memory GitHub Discussion standing in for the room. */
function fakeGh(me: string) {
  let n = 0;
  const room: RoomData = { id: "D1", number: 7, url: "https://gh/d/7", title: "", host: me, closed: false, updatedAt: "t", notes: "", comments: [] };
  const comment = (by: string, body: string) => {
    n += 1;
    const c = { id: `c${n}`, by, body, url: `https://gh/d/7#c${n}`, at: `2026-11-15T00:00:0${n}Z` };
    room.comments.push(c);
    return c;
  };
  const gh: RoomProject["gh"] = {
    createRoom: async (title, host) => {
      Object.assign(room, { title, host });
      return { number: 7, url: room.url, title, host, closed: false, updatedAt: "t" };
    },
    listRooms: async () => [room],
    getRoom: async () => structuredClone(room),
    commentOnRoom: async (_n, body) => {
      const c = comment(me, body);
      return { id: c.id, url: c.url, at: c.at };
    },
    setRoomNotes: async (_n, _h, notes) => {
      room.notes = notes;
    },
    closeDiscussion: async () => {
      room.closed = true;
    },
  };
  return { gh, room, comment };
}

let dir: string;
let sent: string[];

function setup(reply: (text: string) => string) {
  const adapter: AgentAdapter = {
    kind: "claude",
    status: async () => ({ agent: "claude", label: "Claude", installed: true, auth: "subscription", models: [], installUrl: "" }),
    login: async () => ({ message: "" }),
    logout: async () => {},
    start(o: StartOptions) {
      return {
        send: async (text) => {
          sent.push(text);
          setTimeout(() => {
            o.onEvent({ type: "message", id: `m${sent.length}`, text: reply(text) });
            o.onEvent({ type: "turnDone" });
          }, 5);
        },
        interrupt: async () => {},
        close: async () => {},
      };
    },
  };
  const f = fakeGh("alice");
  // eslint-disable-next-line prefer-const
  let rooms: RoomManager;
  const chats = new ChatManager({
    adapters: { claude: adapter, codex: adapter },
    emit: () => {},
    mcp: () => ({ command: "node", args: [], env: {} }),
    approveBridge: () => undefined,
    onTurnDone: (c, t) => rooms.onTurnDone(c, t),
    dir,
  });
  rooms = new RoomManager({ chats, project: async () => ({ gh: f.gh, me: "alice", cwd: dir }), agentLabel: () => "Claude", pollMs: 60_000 });
  return { ...f, chats, rooms };
}

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tandem-rooms-"));
  sent = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("rooms", () => {
  it("feeds everyone's messages to the host's agent and posts its replies back", async () => {
    const t = setup(() => "好的，收到");
    const r = await t.rooms.create("p1", "登入設計", "claude", "");
    expect(r.chatId).toBeTruthy();
    expect(t.room.title).toBe("登入設計");

    await t.rooms.post("p1", 7, "我覺得先做 Email 登入");
    await wait();
    expect(sent[0]).toContain("Tandem 房間");
    expect(sent[0]).toContain("@alice（https://gh/d/7#c1）：\n我覺得先做 Email 登入");
    expect(t.room.comments.at(-1)!.body).toBe("🤖 Claude：\n\n好的，收到");

    // A teammate comments on GitHub; the next poll picks it up, the AI's own comment is skipped.
    t.comment("roy", "Google 登入也要");
    await t.rooms.poll({ projectId: "p1", number: 7 });
    await wait();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe("@roy（https://gh/d/7#c3）：\nGoogle 登入也要");

    const room = await t.rooms.get("p1", 7);
    expect(room.messages.map((m) => [m.by, m.ai, m.text])).toEqual([
      ["alice", false, "我覺得先做 Email 登入"],
      ["alice", true, "好的，收到"],
      ["roy", false, "Google 登入也要"],
      ["alice", true, "好的，收到"],
    ]);
    const chat = await t.chats.get(r.chatId!);
    expect(chat.items.filter((i) => i.kind === "user").map((i) => (i.kind === "user" ? i.by : ""))).toEqual(["alice", "roy"]);
    expect(await t.chats.list("p1")).toEqual([]); // room chats stay out of the normal chat list
    t.rooms.closeAll();
  });

  it("batches messages that arrive while the agent is busy, and writes notes then closes on end", async () => {
    const t = setup((text) => (text.includes("會議筆記") ? "## 重點\n- 先做 Email" : "嗯"));
    await t.rooms.create("p1", "r", "claude", "");
    await t.rooms.post("p1", 7, "第一句");
    t.comment("roy", "第二句");
    t.comment("mei", "第三句");
    await t.rooms.poll({ projectId: "p1", number: 7 });
    await wait();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("@roy");
    expect(sent[1]).toContain("@mei");

    await t.rooms.notes("p1", 7, true);
    await wait();
    expect(t.room.notes).toBe("## 重點\n- 先做 Email");
    expect(t.room.closed).toBe(true);
    expect(t.room.comments.at(-1)!.body).toContain("房間已結束");
    await expect(t.rooms.notes("p1", 7, false)).rejects.toThrow("只有主持人");
  });
});

describe("room marker", async () => {
  const { parseRoomHost, parseRoomNotes, roomBody } = await import("@tandem/core");
  it("round-trips host and notes, and ignores ordinary discussions", () => {
    const b = roomBody("alice", "## 重點\n- 一");
    expect(parseRoomHost(b)).toBe("alice");
    expect(parseRoomNotes(b)).toBe("## 重點\n- 一");
    expect(parseRoomNotes(roomBody("alice", ""))).toBe("（還沒有筆記）");
    expect(parseRoomHost("等：@roy\n\n一般問題")).toBeNull();
  });
});
