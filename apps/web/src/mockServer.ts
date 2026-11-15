/**
 * In-browser fake of the local server so the whole UI can be clicked through with `npx vite`
 * (`?mock=1`, or automatically in dev when no server answers).
 *   ?mock=1&signedin=1  start signed in with two projects (skips sign-in)
 *   ?mock=1&desktop=1   pretend to be the desktop app (shows the auto-start toggle)
 * Repo names containing "fail" make the progress run fail, to show the error state.
 */
import type {
  AgentStatus,
  Chat,
  ChatItem,
  AppEvent,
  AppSession,
  AppSettings,
  DeviceLoginState,
  Invitation,
  OwnerChoice,
  ProjectProgress,
  ProjectRef,
  ProjectStep,
  RepoChoice,
} from "@tandem/contracts";
import { ApiError } from "./api.ts";
import { mockProjectBoard } from "./mock.ts";

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
  },
  { agent: "codex", label: "Codex", installed: false, auth: "none", models: [], installUrl: "https://developers.openai.com/codex" },
];

/** Fake chats: the agent answers with a canned reply and one approval card. */
const chats: Chat[] = [];
function mockChatReply(chat: Chat, text: string) {
  const at = () => new Date().toISOString();
  const push = (item: ChatItem) => {
    chat.items.push(item);
    emit({ type: "chat", data: { chatId: chat.id, type: "item", item } });
  };
  const summary = () => emit({ type: "chat", data: { chatId: chat.id, type: "summary", chat: { ...chat, items: undefined } as never } });
  chat.running = true;
  summary();
  setTimeout(() => {
    push({ kind: "assistant", id: `a${chat.items.length}`, at: at(), text: `（範例回覆）收到：「${text}」。我先看一下專案。` });
    push({ kind: "tool", id: `t${chat.items.length}`, at: at(), name: "Read", summary: "README.md", status: "done", output: "# 範例" });
    push({ kind: "approval", id: `p${chat.items.length}`, at: at(), name: "Bash", summary: "npm test", state: "pending" });
  }, 600);
}

// --- events -----------------------------------------------------------------
const listeners = new Set<(e: AppEvent) => void>();
const emit = (e: AppEvent) => listeners.forEach((l) => l(e));
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
      emit({ type: "chat", data: { chatId: chat.id, type: "deleted" } });
      return { ok: true };
    }
    if (method === "POST" && tail === "/messages") {
      const text = String((body as { text?: string })?.text ?? "");
      const item: ChatItem = { kind: "user", id: `u${chat.items.length}`, at: new Date().toISOString(), text };
      chat.items.push(item);
      if (chat.title === "新對話") chat.title = text.slice(0, 40);
      emit({ type: "chat", data: { chatId: chat.id, type: "item", item } });
      mockChatReply(chat, text);
      return { ok: true };
    }
    if (method === "POST" && (tail === "/interrupt" || tail.startsWith("/approvals/"))) {
      for (const it of chat.items) {
        if (it.kind === "approval" && it.state === "pending") {
          it.state = tail === "/interrupt" || (body as { decision?: string })?.decision === "deny" ? "denied" : "allowed";
          emit({ type: "chat", data: { chatId: chat.id, type: "item", item: it } });
        }
      }
      chat.running = false;
      emit({ type: "chat", data: { chatId: chat.id, type: "summary", chat: { ...chat, items: undefined } as never } });
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
      return mockProjectBoard(id, login ?? ME);
    }
    if (method === "POST" && tail === "/refresh") return mockProjectBoard(id, login ?? ME);
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
    if (method === "POST" && tail === "/open-agent") return { ok: true };
    if (method === "GET" && tail === "/chats") return chats.filter((c) => c.projectId === id).map(({ items: _i, ...c }) => c);
    if (method === "POST" && tail === "/chats") {
      const t = new Date().toISOString();
      const c: Chat = { id: `chat${chats.length + 1}`, projectId: id, agent: "claude", model: String((b as { model?: string }).model ?? ""), title: "新對話", createdAt: t, updatedAt: t, running: false, items: [] };
      chats.push(c);
      return { ...c, items: undefined };
    }
    if (method === "POST" && tail === "/open-folder") return { ok: true };
  }

  throw new ApiError(`mock：沒有實作 ${method} ${p}`, "internal");
}
