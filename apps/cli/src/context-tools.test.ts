/**
 * Shared context through the MCP tools, the brief and the live hook note, against local bare repos
 * standing in for GitHub (code repo + separate data repo via .tandem.json). No network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listContext, renderAgentContext, renderBrief, runGit, syncData, writeContext } from "@tandem/core";
import { assembleContext, type Context } from "./context.ts";
import { buildBrief } from "./gather.ts";
import { newContextNote, rememberContext } from "./live-context.ts";
import { createMcpServer } from "./mcp.ts";

let root: string;
let work: string;
let codeRemote: string;
let dataRemote: string;

const git = async (cwd: string, ...args: string[]) => (await runGit(args, { cwd })).stdout;
const urlFor = (_owner: string, name: string) => path.join(root, `${name}.git`);
const code = { owner: "o", name: "code", url: "https://github.com/o/code" };
const noGh = { discussions: [], pullRequests: [], tasks: [], problems: [] };

async function bare(name: string): Promise<string> {
  const dir = path.join(root, `${name}.git`);
  fs.mkdirSync(dir);
  await runGit(["init", "--bare", "-q", "-b", "main"], { cwd: dir });
  return dir;
}

/** `me`'s context on their own computer (own copy of the data repo). */
function person(me: string, state: Context["state"] = {} as Context["state"]): Promise<Context> {
  return assembleContext(
    { repoRoot: work, remote: code, gh: {} as Context["gh"], me, state, token: "" },
    { gitEnv: {}, data: { baseDir: path.join(root, `app-${me}`), remoteUrlFor: urlFor } },
  );
}

async function mcp(ctx: Context) {
  const server = createMcpServer(async () => ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
      isError?: boolean;
    };
    const text = r.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
    return { text, content: r.content, isError: r.isError === true };
  };
  return { client, call };
}

beforeEach(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-context-")));
  codeRemote = await bare("code");
  dataRemote = await bare("data");
  work = path.join(root, "work");
  await runGit(["clone", "-q", codeRemote, work], { cwd: root });
  for (const [k, v] of [["user.name", "Alice"], ["user.email", "alice@example.com"], ["core.autocrlf", "false"]]) {
    await git(work, "config", k!, v!);
  }
  fs.writeFileSync(path.join(work, "README.md"), "code\n");
  fs.writeFileSync(path.join(work, ".tandem.json"), '{ "dataRepo": "o/data" }\n');
  await git(work, "checkout", "-q", "-B", "main");
  await git(work, "add", ".");
  await git(work, "commit", "-q", "-m", "init");
  await git(work, "push", "-q", "-u", "origin", "main");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

describe("context MCP tools", () => {
  it("write, list and read round-trip through the data repo, with locking and the secret guard", async () => {
    const alice = await person("alice");
    const { client, call } = await mcp(alice);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["tandem_context_list", "tandem_context_read", "tandem_context_write"]));
    expect(client.getInstructions()).toContain("tandem_context_read");

    expect((await call("tandem_context_list")).text).toContain("還是空的");
    const noWhy = await call("tandem_context_write", { path: "notes.md", content: "# 背景\n" });
    expect(noWhy.isError).toBe(true);

    const w = await call("tandem_context_write", { path: "notes.md", content: "# 背景\n做一個記帳 app。\n", why: "記下專案背景", expectVersion: null });
    expect(w.isError).toBe(false);
    expect(w.text).toMatch(/^已存 notes\.md（版本 [0-9a-f]{40}）$/);
    const version = /版本 ([0-9a-f]{40})/.exec(w.text)![1]!;

    // It lives in the data repo only, with the author in the commit message.
    expect(await git(dataRemote, "show", "main:tandem/context/notes.md")).toBe("# 背景\n做一個記帳 app。\n");
    expect(await git(dataRemote, "log", "-1", "--format=%B", "main")).toContain("tandem: context notes.md (@alice)");
    expect((await git(codeRemote, "ls-tree", "-r", "--name-only", "main")).trim().split("\n")).toEqual([".tandem.json", "README.md"]);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");
    expect((await call("tandem_context_write", { path: "ui/home.png", content: png, encoding: "base64", why: "首頁草圖" })).isError).toBe(false);

    const list = await call("tandem_context_list");
    expect(list.text).toMatch(/- notes\.md｜文字｜.*@alice/);
    expect(list.text).toContain("- ui/home.png｜圖片");

    const read = await call("tandem_context_read", {});
    expect(read.text).toContain(`版本：${version}`);
    expect(read.text).toContain("做一個記帳 app。");
    const img = await call("tandem_context_read", { path: "ui/home.png" });
    expect(img.content.find((c) => c.type === "image")).toEqual({ type: "image", data: png, mimeType: "image/png" });

    // Bob changes notes.md from his computer; Alice's stale write is refused.
    const bob = await person("bob");
    await writeContext(bob.store, { path: "notes.md", content: "# 背景\n改成記帳加預算。\n", expectVersion: version }, { me: "bob" });
    const stale = await call("tandem_context_write", { path: "notes.md", content: "# 背景\n我的版本\n", why: "補充", expectVersion: version });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("這個檔案剛被 @bob 改過，請重新載入再改");
    expect(stale.text).toContain("tandem_context_read");
    expect(await git(dataRemote, "show", "main:tandem/context/notes.md")).toBe("# 背景\n改成記帳加預算。\n");

    const leak = await call("tandem_context_write", {
      path: "setup.md",
      content: `用這個：\nSERVICE_TOKEN=${"k3P9wQ2zR7mX5tB8".repeat(2)}\n`,
      why: "設定",
    });
    expect(leak.isError).toBe(true);
    expect(leak.text).toContain("金鑰");
    expect((await call("tandem_context_read", { path: "setup.md" })).isError).toBe(true);
    await client.close();
  });
});

describe("context in the brief and the live hook", () => {
  it("mentions files teammates changed since my last brief, and the start of notes.md", async () => {
    const state = {} as Context["state"];
    const alice = await person("alice", state);
    await writeContext(alice.store, { path: "notes.md", content: "# 背景\n第一行\n" }, { me: "alice" });

    const first = await buildBrief(alice, noGh);
    // My own change is not news to me, but the notes are always there for the agent.
    expect(first.brief.contextChanges).toBeUndefined();
    expect(first.brief.notesHead).toBe("# 背景\n第一行");
    expect(renderAgentContext(first.brief)).toContain("### 共享脈絡 notes.md");
    state.lastBrief = { commit: first.head, time: new Date().toISOString() };
    const session: { contextSeen?: Record<string, string> } = {};
    rememberContext(session, first.contextFiles);

    const bob = await person("bob");
    await writeContext(bob.store, { path: "specs/api.md", content: "# API\n" }, { me: "bob" });
    await syncData(alice.dataRoot, { gitEnv: {} });

    const second = await buildBrief(alice, noGh);
    expect(second.brief.contextChanges).toEqual([{ path: "specs/api.md", by: "bob", deleted: false }]);
    expect(second.brief.quiet).toBe(false);
    expect(renderBrief(second.brief)).toContain("• @bob 更新了共享脈絡：specs/api.md");

    const note = newContextNote(session, await listContext(alice.store), "alice");
    expect(note).toContain("隊友剛改了共享脈絡");
    expect(note).toContain("- specs/api.md（@bob）");
    // Already seen: nothing new the second time; my own edits never show up.
    expect(newContextNote(session, await listContext(alice.store), "alice")).toBeNull();
    await writeContext(alice.store, { path: "notes.md", content: "# 背景\n第二行\n" }, { me: "alice" });
    expect(newContextNote(session, await listContext(alice.store), "alice")).toBeNull();
  });
});
