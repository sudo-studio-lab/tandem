/**
 * In-browser fake of the local server so the whole UI can be clicked through with `npx vite`
 * (`?mock=1`, or automatically in dev when no server answers).
 *   ?mock=1&signedin=1  start signed in with two projects (skips sign-in)
 *   ?mock=1&desktop=1   pretend to be the desktop app (shows the auto-start toggle)
 * Repo names containing "fail" make the progress run fail, to show the error state.
 */
import type {
  AgentStatus,
  AgentKind,
  Chat,
  ChatItem,
  AppEvent,
  Room,
  AppSession,
  AppSettings,
  DeviceLoginState,
  Invitation,
  OwnerChoice,
  ProjectProgress,
  ProjectRef,
  ProjectStep,
  RepoChoice,
  TaskSummary,
} from "@tandem/contracts";
import { ApiError } from "./api.ts";
import { mockProjectBoard } from "./mock.ts";
import { validateChatImages } from "../../../packages/contracts/src/images.ts";
import {
  CONTEXT_MAX_BYTES,
  base64Bytes,
  contextConflictMessage,
  contextKind,
  sortContextFiles,
  validateContextPath,
} from "../../../packages/contracts/src/context.ts";
import type { ContextFile, ContextFileInfo, ContextWriteInput } from "@tandem/contracts";
import { describeSecrets, findSecrets } from "../../../packages/core/src/context/secrets.ts";

const params = new URLSearchParams(location.search);
const ME = "jielle2453";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const projects: ProjectRef[] = [];
let login: string | null = null;
let currentProjectId: string | null = null;

const settings: AppSettings = {
  notifications: { waiting: true, review: true, task: false },
  openAtLogin: false,
};

let invitations: Invitation[] = [
  {
    id: 101,
    repo: { owner: "sudo-studio-lab", name: "tandem", fullName: "sudo-studio-lab/tandem", private: true },
    inviter: "theroyatlas",
    createdAt: ago(3_600_000),
  },
  {
    id: 102,
    repo: { owner: "mei-lin", name: "recipe-book", fullName: "mei-lin/recipe-book", private: false },
    inviter: "mei-lin",
    createdAt: ago(2 * 86_400_000),
  },
];

const repos: RepoChoice[] = [
  { owner: ME, name: "demo-project", fullName: `${ME}/demo-project`, private: true, isTandem: true, pushedAt: ago(86_400_000) },
  { owner: ME, name: "blog", fullName: `${ME}/blog`, private: false, pushedAt: ago(5 * 86_400_000) },
  { owner: ME, name: "fail-demo", fullName: `${ME}/fail-demo`, private: true, pushedAt: ago(9 * 86_400_000) },
  { owner: "sudo-studio-lab", name: "website", fullName: "sudo-studio-lab/website", private: true, pushedAt: ago(30 * 86_400_000) },
  { owner: "sudo-studio-lab", name: "tandem", fullName: "sudo-studio-lab/tandem", private: true, isTandem: true },
];

const owners: OwnerChoice[] = [
  { login: ME, kind: "user" },
  { login: "sudo-studio-lab", kind: "org" },
];

const agents: AgentStatus[] = [
  {
    agent: "claude",
    label: "Claude",
    installed: true,
    version: "2.1.0",
    auth: "subscription",
    plan: "pro",
    models: [
      { id: "", label: "預設", isDefault: true },
      { id: "sonnet", label: "Sonnet" },
    ],
    installUrl: "https://code.claude.com/docs/en/setup",
    supportsImages: true,
    supportsSteer: false,
  },
  { agent: "codex", label: "Codex", installed: true, auth: "subscription", supportsImages: true, supportsSteer: true, models: [{ id: "", label: "預設" }, { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] }], installUrl: "https://developers.openai.com/codex" },
  ...(["antigravity", "grok", "cursor"] as const).map((kind) => ({ agent: kind, label: kind === "grok" ? "Grok" : kind === "cursor" ? "Cursor" : "Antigravity", installed: true, auth: "authenticated" as const, managedAuthExternally: true, supportsImages: true, supportsSteer: false, models: [{ id: "", label: "預設（範例）" }], installUrl: "#" })),
];

/** Fake chats: the agent answers with a canned reply and one approval card. */
const chats: Chat[] = (() => {
  try { return JSON.parse(sessionStorage.getItem("tandem:mock:chats") ?? "[]").map((chat: Chat) => ({ ...chat, running: false, queuePaused: !!chat.queue?.length })); } catch { return []; }
})();
const mockRuns = new Map<string, number>();
function saveChats() { try { sessionStorage.setItem("tandem:mock:chats", JSON.stringify(chats)); } catch { /* demo only */ } }
function chatSummary(chat: Chat) { saveChats(); emit({ type: "chat", data: { chatId: chat.id, type: "summary", chat: { ...chat, items: undefined } as never } }); }
function drainMock(chat: Chat) {
  if (chat.running || chat.queuePaused) return;
  const next = chat.queue?.shift();
  if (!next) return;
  const item: ChatItem = { kind: "user", id: crypto.randomUUID(), at: new Date().toISOString(), text: next.text, images: next.images };
  chat.items.push(item); emit({ type: "chat", data: { chatId: chat.id, type: "item", item } });
  mockChatReply(chat, next.text);
}
function mockChatReply(chat: Chat, text: string) {
  const run = (mockRuns.get(chat.id) ?? 0) + 1; mockRuns.set(chat.id, run);
  const at = () => new Date().toISOString();
  const push = (item: ChatItem) => {
    chat.items.push(item);
    emit({ type: "chat", data: { chatId: chat.id, type: "item", item } });
    saveChats();
  };
  const summary = () => chatSummary(chat);
  chat.running = true;
  summary();
  setTimeout(() => {
    if (mockRuns.get(chat.id) !== run || !chat.running) return;
    push({ kind: "assistant", id: `a${chat.items.length}`, at: at(), text: `（範例回覆）收到：「${text}」。我先看一下專案。` });
    push({ kind: "tool", id: `t${chat.items.length}`, at: at(), name: "Read", summary: "README.md", status: "done", output: "# 範例" });
    push({ kind: "approval", id: `p${chat.items.length}`, at: at(), name: "Bash", summary: "npm test", state: "pending" });
  }, 600);
}

/** Fake rooms: one hosted by a teammate (guest view), plus any you start (host view). */
const rooms: Room[] = [
  {
    number: 21,
    url: "https://github.com/sudo-studio-lab/tandem/discussions/21",
    title: "登入流程要怎麼做",
    host: "theroyatlas",
    closed: false,
    updatedAt: ago(4 * 60_000),
    notes: ["## 重點", "- 第一版先做 GitHub 登入", "- Google 登入等有使用者再說", "", "## 待辦", "- @theroyatlas 畫登入流程圖"].join("\n"),
    messages: [
      { id: "r1", by: "theroyatlas", text: "登入要不要一開始就支援 Google？", url: "#r1", at: ago(20 * 60_000), ai: false },
      { id: "r2", by: ME, text: "我覺得先只做 GitHub 就好，我們的使用者都有 GitHub", url: "#r2", at: ago(18 * 60_000), ai: false },
      { id: "r3", by: "theroyatlas", text: "（範例回覆）同意先只做 GitHub 登入。D-20261115-za46 已經記了「假設使用者都會用 GitHub」，跟這個方向一致。要我把「第一版只做 GitHub 登入」記成決定嗎？", url: "#r3", at: ago(17 * 60_000), ai: true },
    ],
  },
];
function mockRoomSay(room: Room, text: string) {
  const at = () => new Date().toISOString();
  room.messages.push({ id: `r${room.messages.length + 1}`, by: ME, text, url: "#", at: at(), ai: false });
  const chat = room.chatId ? chats.find((c) => c.id === room.chatId) : undefined;
  if (chat) {
    const item: ChatItem = { kind: "user", id: `u${chat.items.length}`, at: at(), text, by: ME, url: "#" };
    chat.items.push(item);
    emit({ type: "chat", data: { chatId: chat.id, type: "item", item } });
    chat.running = true;
  }
  setTimeout(() => {
    const reply = `（範例回覆）收到 @${ME} 的「${text}」。大家還有其他想法嗎？`;
    room.messages.push({ id: `r${room.messages.length + 1}`, by: room.host, text: reply, url: "#", at: at(), ai: true });
    if (chat) {
      const item: ChatItem = { kind: "assistant", id: `a${chat.items.length}`, at: at(), text: reply };
      chat.items.push(item);
      emit({ type: "chat", data: { chatId: chat.id, type: "item", item } });
      chat.running = false;
      emit({ type: "chat", data: { chatId: chat.id, type: "summary", chat: { ...chat, items: undefined } as never } });
    }
  }, 1500);
}

// --- events -----------------------------------------------------------------
const listeners = new Set<(e: AppEvent) => void>();
const emit = (e: AppEvent) => listeners.forEach((l) => l(structuredClone(e)));
export function subscribe(l: (e: AppEvent) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function session(): AppSession {
  return {
    login,
    tokenSource: login ? "keyring" : null,
    projects: projects.map((p) => ({ ...p })),
    currentProjectId,
    projectsDir: "C:\\Users\\demo\\Tandem",
    desktop: params.get("desktop") === "1",
    version: "0.0.0-mock",
  };
}
const emitSession = () => emit({ type: "session", data: session() });

function addProject(fullName: string, attention = 0, available = true): ProjectRef {
  const id = fullName.toLowerCase();
  const [owner = "", name = ""] = fullName.split("/");
  const existing = projects.find((p) => p.id === id);
  if (existing) return existing;
  const p: ProjectRef = { id, owner, name, path: `C:\\Users\\demo\\Tandem\\${name}`, available, attention };
  projects.push(p);
  return p;
}

if (params.get("signedin") === "1") {
  login = ME;
  addProject(`${ME}/demo-project`, 2);
  addProject("sudo-studio-lab/tandem", 0);
  addProject(`${ME}/old-stuff`, 0, false);
  currentProjectId = `${ME}/demo-project`;
}

// --- progress runs ----------------------------------------------------------
let opCounter = 0;
function runProgress(fullName: string, withAccept: boolean) {
  const opId = `op-${++opCounter}`;
  const steps: [ProjectStep, string][] = [
    ...(withAccept ? ([["accept", "接受邀請…"]] as [ProjectStep, string][]) : []),
    ["clone", "下載專案資料…"],
    ["setup", "準備 Tandem…"],
    ["push", "上傳設定…"],
  ];
  const emitP = (p: Omit<ProjectProgress, "opId">) => emit({ type: "progress", data: { opId, ...p } });
  void (async () => {
    await sleep(150);
    for (const [step, message] of steps) {
      emitP({ step, message });
      await sleep(1100);
      if (fullName.includes("fail") && step === "clone") {
        emitP({
          step,
          message: "下載失敗",
          error: {
            code: "github",
            message: "下載專案資料失敗，可能是網路不穩。請再試一次。",
            detail: "fatal: unable to access 'https://github.com/…': Could not resolve host (mock)",
          },
        });
        return;
      }
    }
    const p = addProject(fullName, 1);
    currentProjectId = p.id;
    emitP({ step: "done", message: "完成", projectId: p.id });
    emitSession();
  })();
  return { opId };
}

// --- tasks made on the board (kept per project for this page load) ------------
const madeTasks = new Map<string, TaskSummary[]>();
function boardFor(id: string) {
  const b = mockProjectBoard(id, login ?? ME);
  const extra = madeTasks.get(id) ?? [];
  return { ...b, tasks: [...extra, ...b.tasks] };
}

// --- shared context (脈絡) ----------------------------------------------------
// Saving "specs/conflict-demo.md" the first time pretends a teammate changed it just before.
const FLOW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 200" font-family="system-ui, sans-serif" font-size="14">
  <rect width="480" height="200" fill="#f7f8fa"/>
  <g fill="#ffffff" stroke="#cfd4dc" stroke-width="1.5">
    <rect x="16" y="70" width="120" height="60" rx="10"/>
    <rect x="180" y="56" width="120" height="88" rx="10" fill="#e8efff" stroke="#2259d6"/>
    <rect x="344" y="70" width="120" height="60" rx="10"/>
  </g>
  <g stroke="#667085" stroke-width="2" fill="none">
    <path d="M136 100 H172"/><path d="M164 94 L172 100 L164 106"/>
    <path d="M344 100 H308"/><path d="M316 94 L308 100 L316 106"/>
  </g>
  <g fill="#1a2130" text-anchor="middle">
    <text x="76" y="105">你的 AI</text>
    <text x="240" y="95" font-weight="600">共享脈絡</text>
    <text x="240" y="117" fill="#667085" font-size="12">notes.md・規格・圖</text>
    <text x="404" y="105">隊友的 AI</text>
  </g>
</svg>
`;

interface MockContextFile {
  content: string;
  encoding: "utf8" | "base64";
  by: string;
  at: string;
}
const contextFiles = new Map<string, Map<string, MockContextFile>>();
let conflictDemoUsed = false;

/** FNV-1a: a stand-in for the git blob sha. */
function mockVersion(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(5);
}

function contextFor(projectId: string): Map<string, MockContextFile> {
  let m = contextFiles.get(projectId);
  if (!m) {
    m = new Map([
      [
        "notes.md",
        {
          content: [
            "# 專案背景",
            "",
            "做一個給小團隊的記帳 app，先做網頁版。",
            "",
            "## 架構",
            "- 前端：React",
            "- 資料：先存在瀏覽器，之後再接雲端",
            "",
            "## 需求",
            "- 三個人以內可以一起記",
            "- 每月自動結算",
          ].join("\n"),
          encoding: "utf8",
          by: "theroyatlas",
          at: ago(3 * 3_600_000),
        },
      ],
      ["diagrams/flow.svg", { content: FLOW_SVG, encoding: "utf8", by: ME, at: ago(26 * 3_600_000) }],
      ["specs/conflict-demo.md", { content: "# 衝突示範\n\n改這個檔案再按儲存，會看到別人剛改過的提示。\n", encoding: "utf8", by: ME, at: ago(2 * 86_400_000) }],
    ]);
    contextFiles.set(projectId, m);
  }
  return m;
}

function contextInfo(path: string, f: MockContextFile): ContextFileInfo {
  const k = contextKind(path)!;
  const size = f.encoding === "base64" ? base64Bytes(f.content) : new TextEncoder().encode(f.content).length;
  return { path, kind: k.kind, mime: k.mime, size, version: mockVersion(f.content), by: f.by, at: f.at };
}

function contextConflict(path: string, by: string, version: string | null): never {
  throw new ApiError(contextConflictMessage(by), "conflict", { path, version, by });
}

function writeMockContext(projectId: string, input: Partial<ContextWriteInput>, del = false): unknown {
  let path: string;
  try {
    path = validateContextPath(String(input.path ?? ""));
  } catch (e) {
    throw new ApiError((e as Error).message, "validation");
  }
  const files = contextFor(projectId);
  const cur = files.get(path);
  const curVersion = cur ? mockVersion(cur.content) : null;
  if (input.expectVersion !== undefined && input.expectVersion !== curVersion) contextConflict(path, cur?.by ?? "theroyatlas", curVersion);
  if (path === "specs/conflict-demo.md" && cur && !conflictDemoUsed && !del) {
    conflictDemoUsed = true;
    cur.content += "\n（@theroyatlas 剛補了一行）\n";
    cur.by = "theroyatlas";
    cur.at = new Date().toISOString();
    contextConflict(path, "theroyatlas", mockVersion(cur.content));
  }
  if (del) {
    if (!cur) throw new ApiError(`找不到 ${path}`, "validation");
    files.delete(path);
    return { path, version: null, result: "pushed" };
  }
  const content = String(input.content ?? "");
  const encoding = input.encoding === "base64" ? "base64" : "utf8";
  const kind = contextKind(path)!.kind;
  if (kind === "image" && encoding !== "base64") throw new ApiError("圖片要用 base64 傳", "validation");
  const bytes = encoding === "base64" ? base64Bytes(content) : new TextEncoder().encode(content).length;
  if (bytes > CONTEXT_MAX_BYTES) throw new ApiError("檔案太大，每個檔案最多 2 MB", "validation");
  if (kind === "text") {
    const msg = describeSecrets(findSecrets(content));
    if (msg) throw new ApiError(msg, "validation");
  }
  files.set(path, { content, encoding, by: login ?? ME, at: new Date().toISOString() });
  return { path, version: mockVersion(content), result: "pushed" };
}

// --- device login -----------------------------------------------------------
const deviceStarts = new Map<string, number>();

// --- router -----------------------------------------------------------------
export async function handle(method: string, path: string, body: unknown): Promise<unknown> {
  await sleep(120);
  const url = new URL(path, location.origin);
  const p = url.pathname;
  const b = (body ?? {}) as Record<string, string>;
  let m: RegExpMatchArray | null;

  if (method === "GET" && p === "/api/session") return session();

  if (method === "POST" && p === "/api/login/device") {
    const id = `dev-${Date.now()}`;
    deviceStarts.set(id, Date.now());
    return { id, userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresIn: 900 };
  }
  if (method === "GET" && (m = p.match(/^\/api\/login\/device\/([^/]+)$/))) {
    const started = deviceStarts.get(m[1]!);
    if (started === undefined) return { state: "expired" } satisfies DeviceLoginState;
    if (Date.now() - started < 6000) return { state: "pending" } satisfies DeviceLoginState;
    if (!login) {
      login = ME;
      emitSession();
    }
    return { state: "done", login: ME } satisfies DeviceLoginState;
  }
  if (method === "POST" && p === "/api/logout") {
    login = null;
    projects.length = 0;
    currentProjectId = null;
    emitSession();
    return { ok: true };
  }

  if (method === "GET" && p === "/api/github/repos") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return repos
      .filter((r) => r.fullName.toLowerCase().includes(q))
      .map((r) => ({ ...r, localProjectId: projects.find((x) => x.id === r.fullName.toLowerCase())?.id }));
  }
  if (method === "GET" && p === "/api/github/owners") return owners;
  if (method === "GET" && p === "/api/invitations") {
    const hint = (url.searchParams.get("hint") ?? "").toLowerCase();
    return invitations.map((i) => ({ ...i, hinted: !!hint && i.repo.fullName.toLowerCase() === hint }));
  }
  if (method === "POST" && (m = p.match(/^\/api\/invitations\/(\d+)\/accept$/))) {
    const inv = invitations.find((i) => i.id === Number(m![1]));
    if (!inv) throw new ApiError("找不到這個邀請，可能已經被接受了", "github");
    invitations = invitations.filter((i) => i !== inv);
    return runProgress(inv.repo.fullName, true);
  }
  if (method === "POST" && p === "/api/projects") return runProgress(b.repo ?? "demo/unknown", false);
  if (method === "POST" && p === "/api/projects/new") {
    if (!b.owner || !b.name) throw new ApiError("請填寫擁有者和名稱", "validation");
    return runProgress(`${b.owner}/${b.name}`, false);
  }
  if (method === "POST" && p === "/api/projects/open-folder") {
    const folder = (b.path ?? "").trim();
    if (!folder) throw new ApiError("請輸入資料夾路徑", "validation");
    if (folder.includes("nope")) throw new ApiError("這個資料夾裡沒有 Git 專案", "not_a_repo");
    const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? "folder";
    const proj = addProject(`${ME}/${name}`);
    proj.path = folder;
    currentProjectId = proj.id;
    emitSession();
    return { id: proj.id };
  }

  if (method === "GET" && p === "/api/agents") return agents;
  if ((m = p.match(/^\/api\/chats\/([^/]+)(\/.*)?$/))) {
    const chat = chats.find((c) => c.id === m![1]);
    if (!chat) throw new ApiError("找不到這段對話", "usage");
    const tail = m[2] ?? "";
    if (method === "GET" && !tail) return chat;
    if (method === "DELETE" && !tail) {
      chats.splice(chats.indexOf(chat), 1);
      saveChats();
      emit({ type: "chat", data: { chatId: chat.id, type: "deleted" } });
      return { ok: true };
    }
    if (method === "PATCH" && !tail) {
      if (chat.running) throw new ApiError("請先等目前回覆完成", "usage");
      Object.assign(chat, body); chatSummary(chat); return { ...chat, items: undefined };
    }
    if (method === "POST" && tail === "/queue/resume") { chat.queuePaused = false; drainMock(chat); chatSummary(chat); return { ok: true }; }
    if (/^\/queue\/[^/]+$/.test(tail)) {
      const id = tail.split("/")[2];
      const message = chat.queue?.find((q) => q.id === id);
      if (!message) throw new ApiError("訊息已送出或移除", "usage");
      if (method === "DELETE") chat.queue = chat.queue!.filter((q) => q.id !== id);
      if (method === "PATCH") Object.assign(message, body);
      chatSummary(chat); return { ok: true };
    }
    if (method === "POST" && tail === "/messages") {
      const text = String((body as { text?: string })?.text ?? "");
      const request = body as { mode?: string; images?: unknown };
      const images = validateChatImages(request.images);
      if (params.get("failSend") === "1") throw new ApiError("範例：送出失敗，草稿仍保留", "network");
      if (request.mode === "queue") {
        (chat.queue ??= []).push({ id: crypto.randomUUID(), text, images, at: new Date().toISOString() });
        chatSummary(chat); drainMock(chat); return { ok: true };
      }
      if (request.mode === "steer" && (!chat.running || chat.agent !== "codex")) throw new ApiError("目前無法補充", "usage");
      if (request.mode !== "steer" && chat.running) throw new ApiError("目前仍在回覆", "usage");
      const item: ChatItem = { kind: "user", id: `u${chat.items.length}`, at: new Date().toISOString(), text, ...(images.length ? { images } : {}) };
      chat.items.push(item);
      if (chat.title === "新對話") chat.title = text.slice(0, 40);
      emit({ type: "chat", data: { chatId: chat.id, type: "item", item } });
      if (request.mode !== "steer") mockChatReply(chat, text);
      else saveChats();
      return { ok: true };
    }
    if (method === "POST" && (tail === "/interrupt" || tail.startsWith("/approvals/"))) {
      if (tail === "/interrupt") { chat.queuePaused = true; mockRuns.set(chat.id, (mockRuns.get(chat.id) ?? 0) + 1); }
      for (const it of chat.items) {
        if (it.kind === "approval" && it.state === "pending") {
          it.state = tail === "/interrupt" || (body as { decision?: string })?.decision === "deny" ? "denied" : "allowed";
          emit({ type: "chat", data: { chatId: chat.id, type: "item", item: it } });
        }
      }
      chat.running = false;
      chatSummary(chat); drainMock(chat);
      return { ok: true };
    }
  }
  if (method === "GET" && p === "/api/settings") return settings;
  if (method === "PUT" && p === "/api/settings") {
    Object.assign(settings, body);
    return settings;
  }

  if ((m = p.match(/^\/api\/projects\/([^/]+)(\/.*)?$/))) {
    const id = decodeURIComponent(m[1]!);
    const tail = m[2] ?? "";
    const proj = projects.find((x) => x.id === id);
    if (!proj) throw new ApiError("找不到這個專案", "usage");
    if (method === "DELETE" && !tail) {
      projects.splice(projects.indexOf(proj), 1);
      if (currentProjectId === id) currentProjectId = projects[0]?.id ?? null;
      emitSession();
      return { ok: true };
    }
    if (method === "POST" && tail === "/select") {
      currentProjectId = id;
      emitSession();
      return { ok: true };
    }
    if (method === "GET" && tail === "/board") {
      if (!proj.available) throw new ApiError("找不到資料夾", "not_a_repo");
      return boardFor(id);
    }
    if (method === "POST" && tail === "/refresh") return boardFor(id);
    if (method === "POST" && tail === "/tasks") {
      const t = body as { title?: unknown; body?: unknown; assign?: unknown };
      const title = typeof t.title === "string" ? t.title.trim() : "";
      if (!title) throw new ApiError("請輸入任務標題", "usage");
      if (title.length > 256) throw new ApiError("標題最多 256 個字", "usage");
      if (title.includes("fail")) throw new ApiError("範例：建立任務失敗，請再試一次", "github");
      const assign = (Array.isArray(t.assign) ? t.assign : []).map((x) => String(x).replace(/^@/, ""));
      const bad = assign.find((l) => !/^[A-Za-z0-9-]{1,39}$/.test(l));
      if (bad !== undefined) throw new ApiError(`「${bad}」不是正確的 GitHub 帳號`, "usage");
      await sleep(500);
      const list = madeTasks.get(id) ?? [];
      const number = 40 + list.length;
      const now = new Date().toISOString();
      const url = `https://github.com/${proj.owner}/${proj.name}/issues/${number}`;
      list.unshift({ number, title, url, state: "open", assignees: [...new Set(assign)], labels: ["tandem:task"], author: login ?? ME, blockedBy: [], createdAt: now, updatedAt: now });
      madeTasks.set(id, list);
      emit({ type: "board", data: boardFor(id) });
      return { number, url };
    }
    if (method === "POST" && tail === "/sync") {
      emit({ type: "sync", data: { projectId: id, state: "syncing" } });
      setTimeout(() => emit({ type: "sync", data: { projectId: id, state: "idle", lastSyncAt: new Date().toISOString() } }), 1200);
      return { state: "syncing" };
    }
    if (method === "POST" && tail === "/invite") {
      const who = (b.login ?? "").replace(/^@/, "");
      if (!who) throw new ApiError("請輸入 GitHub 帳號", "validation");
      if (who === "nobody") throw new ApiError("GitHub 上找不到 @nobody 這個人", "github");
      const url2 = `https://github.com/${proj.owner}/${proj.name}`;
      return {
        shareText: `@${who}，我邀請你一起用 Tandem 做「${proj.name}」。\n1. 下載 Tandem：https://example.com/tandem\n2. 用 GitHub 登入，就會看到邀請\n（專案：${url2}）`,
        url: url2,
      };
    }
    if (method === "GET" && tail === "/context") {
      return sortContextFiles([...contextFor(id)].map(([path, f]) => contextInfo(path, f)));
    }
    if (tail === "/context/file") {
      const q = url.searchParams;
      if (method === "GET") {
        const path = q.get("path") ?? "";
        const f = contextFor(id).get(path);
        if (!f) throw new ApiError("找不到這個檔案，可能已經被刪掉了", "usage");
        return { ...contextInfo(path, f), content: f.content, encoding: f.encoding } satisfies ContextFile;
      }
      if (method === "PUT") return writeMockContext(id, body as Partial<ContextWriteInput>);
      if (method === "DELETE") return writeMockContext(id, { path: q.get("path") ?? "", ...(q.get("expectVersion") ? { expectVersion: q.get("expectVersion") } : {}) }, true);
    }
    if (method === "POST" && tail === "/open-agent") return { ok: true };
    if (method === "GET" && tail === "/chats") return chats.filter((c) => c.projectId === id && !c.room).map(({ items: _i, ...c }) => c);
    if (method === "POST" && tail === "/chats") {
      const t = new Date().toISOString();
      const c: Chat = { id: crypto.randomUUID(), projectId: id, agent: ((b as { agent?: AgentKind }).agent ?? "claude"), model: String((b as { model?: string }).model ?? ""), title: "新對話", createdAt: t, updatedAt: t, running: false, items: [] };
      chats.push(c);
      saveChats();
      chatSummary(c);
      return { ...c, items: undefined };
    }
    if (method === "POST" && tail === "/open-folder") return { ok: true };
    if (method === "GET" && tail === "/rooms") return rooms.map(({ messages: _m, notes: _n, chatId: _c, running: _r, ...r }) => r);
    if (method === "POST" && tail === "/rooms") {
      const t = new Date().toISOString();
      const number = 30 + rooms.length;
      const title = String((b as { title?: string }).title || "房間");
      const c: Chat = { id: `chat${chats.length + 1}`, projectId: id, agent: "claude", model: "", title, createdAt: t, updatedAt: t, running: false, items: [], room: { number, url: "#" } };
      chats.push(c);
      const r: Room = { number, url: `https://github.com/${proj.owner}/${proj.name}/discussions/${number}`, title, host: ME, closed: false, updatedAt: t, notes: "", messages: [], chatId: c.id };
      rooms.unshift(r);
      return r;
    }
    if ((m = tail.match(/^\/rooms\/(\d+)(\/.*)?$/))) {
      const room = rooms.find((r) => r.number === Number(m![1]));
      if (!room) throw new ApiError("找不到這個房間", "usage");
      const sub = m[2] ?? "";
      if (method === "GET" && !sub) return { ...room, running: room.chatId ? chats.find((c) => c.id === room.chatId)?.running : undefined };
      if (method === "POST" && sub === "/messages") {
        mockRoomSay(room, String((body as { text?: string })?.text ?? ""));
        return { ok: true };
      }
      if (method === "POST" && sub === "/notes") {
        if (room.host !== ME) throw new ApiError("只有主持人的電腦能整理筆記和結束房間", "usage");
        room.notes = ["## 重點", ...room.messages.filter((x) => !x.ai).map((x) => `- @${x.by}：${x.text}`)].join("\n");
        if ((body as { end?: boolean })?.end) room.closed = true;
        return { ok: true };
      }
    }
  }

  throw new ApiError(`mock：沒有實作 ${method} ${p}`, "internal");
}
