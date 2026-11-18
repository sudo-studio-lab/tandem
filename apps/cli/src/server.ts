/**
 * Local app server: one process serves every project on this computer.
 * Used by `tandem` (browser) and by the desktop app (`tandem serve`).
 * Binds 127.0.0.1 only; a one-time token becomes a cookie; the desktop main process
 * may also send it as a Bearer header. The desktop app can also pass a long-lived
 * side-panel key: `/?t=<key>` becomes a year-long cookie, so an editor's built-in
 * browser keeps working across app restarts and updates. Updates go out over
 * Server-Sent Events.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import os from "node:os";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { Hono, type Context as HonoContext } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import open from "open";
import {
  PRODUCT,
  TandemError,
  type ActivityItem,
  type AgentAvailability,
  type AgentKind,
  type ApprovalDecision,
  type AppEvent,
  type AppSession,
  type AppSettings,
  type ContextWriteInput,
  type DeviceLoginState,
  type Invitation,
  type ProjectBoard,
  type ProjectProgress,
  type ProjectRef,
  type RepoChoice,
  type SyncState,
} from "@tandem/contracts";
import {
  attentionCount,
  clearToken,
  computeActivity,
  computeNotifications,
  createGitHubClient,
  getGitHubToken,
  loadAppState,
  pollDeviceLogin,
  projectIdFor,
  saveToken,
  startDeviceLogin,
  deleteContext,
  listContext,
  readContext,
  syncData,
  updateAppState,
  writeContext,
  agentMembers,
  listAgentMessages,
  sendAgentMessage,
  changeAgentMessage,
  requirePrivateMessages,
  sharedChats,
} from "@tandem/core";
import { AgentMessageWorker, localAgentSettings, saveAgentSettings, projectKey } from "./agent-messages.ts";
import { projectTranscripts } from "./project-transcripts.ts";
import { projectMembers, removeProjectMember, resetShareLink } from "./members.ts";
import { confirmSharing, previewSharing, sharedChatFor, sharingSettings, stopSharing, syncSharedChats } from "./shared-chats.ts";
import { createHandoff, listHandoffs } from "./handoffs.ts";
import { openContext, requirePrivateDataRepo, type Context } from "./context.ts";
import { buildBoard, gatherGitHub, type GitHubData } from "./gather.ts";
import { inviteLogin } from "./commands.ts";
import { info } from "./io.ts";
import { rememberProject, startProject, joinProject } from "./setup.ts";
import { ADAPTERS, agentStatuses } from "./agents/index.ts";
import { ACP_INFO } from "./agents/acp.ts";
import type { McpLaunch } from "./agents/types.ts";
import { ChatManager } from "./chats/manager.ts";
import { RoomManager } from "./rooms/manager.ts";
import pkg from "../package.json" with { type: "json" };

const DEFAULT_PORT = 4318;
const GITHUB_POLL_MS = 3 * 60_000;
const COOKIE = "tandem_session";
/** The side-panel cookie: its own name, so it never clobbers a session cookie on the same host. */
const SIDEBAR_COOKIE = "tandem_sidebar";
const SIDEBAR_COOKIE_MAX_AGE = 365 * 24 * 3600;
/** Ports tried after the preferred one before falling back to a random port (desktop only). */
const PORT_TRIES = 20;

/** Constant-time compare; an empty secret never matches. */
function sameSecret(given: string | undefined, secret: string): boolean {
  if (!given || !secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
const ACTIVITY_DAYS = 7;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function clientDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Bundled: dist/bin.js + dist/client (or dist-desktop). Dev: apps/cli/src → apps/web/dist.
  const candidates = [path.join(here, "client"), path.resolve(here, "../../web/dist")];
  return candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[0]!;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errCode = (e: unknown) => (e instanceof TandemError ? e.code : "internal");
const httpStatus = (code: string) =>
  code === "usage" || code === "validation"
    ? 400
    : code === "auth"
      ? 401
      : code === "needs_human"
        ? 403
        : code === "conflict"
          ? 409
          : code === "offline"
            ? 503
            : 500;

// ---------------------------------------------------------------------------
// Per-project runtime
// ---------------------------------------------------------------------------
interface ProjectRuntime {
  id: string;
  ctx: Context;
  gh: GitHubData;
  activity: Record<string, ActivityItem[]>;
  extraLogins: string[];
  sync: SyncState;
  board: ProjectBoard | null;
  attention: number;
  /** First board in this process: existing items are marked seen instead of popping up all at once. */
  seeded: boolean;
}

export interface ServerOptions {
  cwd?: string;
  port?: number;
  openBrowser?: boolean;
  /** Session token chosen by the parent (desktop). */
  sessionToken?: string;
  desktop?: boolean;
  /** Print a ServeReadyLine on stdout (desktop). */
  readyLine?: boolean;
  /**
   * Long-lived key for an editor's side panel (desktop). `/?t=<key>` is swapped for a cookie that
   * holds a value derived from the key, so replacing the key (POST /internal/sidebar-key) ends old cookies.
   */
  sidebarKey?: string;
}

export interface AppServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions = {}): Promise<AppServer> {
  const sessionToken = opts.sessionToken ?? randomBytes(24).toString("base64url");
  const desktop = !!opts.desktop;
  let sidebarKey = opts.sidebarKey ?? "";
  const sidebarCookie = () => (sidebarKey ? createHmac("sha256", sidebarKey).update("tandem-sidebar-cookie").digest("base64url") : "");
  const listeners = new Set<(e: AppEvent) => void>();
  const emit = (e: AppEvent) => listeners.forEach((l) => l(e));

  // --- GitHub token / login ------------------------------------------------
  let auth: { token: string; source: "env" | "keyring" | "gh"; login: string } | null = null;
  async function loadAuth(): Promise<void> {
    try {
      const t = await getGitHubToken();
      const login = await createGitHubClient({ token: t.token, owner: "_", repo: "_" }).viewerLogin();
      auth = { token: t.token, source: t.source, login };
    } catch {
      auth = null;
    }
  }
  const requireAuth = () => {
    if (!auth) throw new TandemError("auth", "請先用 GitHub 登入");
    return auth;
  };
  const userClient = () => createGitHubClient({ token: requireAuth().token, owner: "_", repo: "_" });

  // --- projects -------------------------------------------------------------
  const runtimes = new Map<string, ProjectRuntime>();
  const opening = new Map<string, Promise<ProjectRuntime>>();
  const messageWorkers = new Map<string, AgentMessageWorker>();
  const messageWorker = (rt: ProjectRuntime) => {
    let w = messageWorkers.get(rt.id);
    if (!w) { w = new AgentMessageWorker(mcpLaunch); messageWorkers.set(rt.id, w); }
    return w;
  };

  async function openRuntime(id: string): Promise<ProjectRuntime> {
    const existing = runtimes.get(id);
    if (existing) return existing;
    const pending = opening.get(id);
    if (pending) return pending;
    const p = (async () => {
      const a = requireAuth();
      const app = await loadAppState();
      const proj = app.projects.find((x) => x.id === id);
      if (!proj) throw new TandemError("usage", "找不到這個專案");
      if (!existsSync(path.join(proj.path, ".git"))) throw new TandemError("not_a_repo", `找不到專案資料夾：${proj.path}`);
      const ctx = await openContext(proj.path, { token: a.token });
      const rt: ProjectRuntime = {
        id,
        ctx,
        gh: { discussions: [], pullRequests: [], tasks: [], problems: [] },
        activity: {},
        extraLogins: [],
        sync: { state: "idle" },
        board: null,
        attention: 0,
        seeded: false,
      };
      runtimes.set(id, rt);
      return rt;
    })();
    opening.set(id, p);
    try {
      return await p;
    } finally {
      opening.delete(id);
    }
  }

  async function refreshGitHub(rt: ProjectRuntime): Promise<void> {
    rt.gh = await gatherGitHub(rt.ctx);
    try {
      const since = new Date(Date.now() - ACTIVITY_DAYS * 24 * 3600 * 1000).toISOString();
      const [raw, collaborators] = await Promise.all([
        rt.ctx.gh.getActivityRaw({ since }),
        rt.ctx.gh.listCollaborators().catch(() => [] as string[]),
      ]);
      const seen = new Set<string>();
      const logins = [
        ...collaborators,
        ...raw.commits.map((c) => c.login),
        ...raw.pullRequests.map((p) => p.author),
        ...raw.comments.map((c) => c.login),
      ].filter((l): l is string => !!l && !l.endsWith("[bot]") && !seen.has(l.toLowerCase()) && !!seen.add(l.toLowerCase()));
      rt.extraLogins = logins;
      rt.activity = computeActivity(raw, { members: [rt.ctx.me, ...logins] });
    } catch (e) {
      rt.gh.problems.push({ path: "github:activity", severity: "warning", code: "github-unavailable", message: `暫時讀不到最近動態：${errMsg(e)}` });
    }
  }

  async function rebuild(rt: ProjectRuntime, refresh: boolean): Promise<ProjectBoard> {
    if (refresh) await refreshGitHub(rt);
    const base = await buildBoard(rt.ctx, rt.gh, rt.sync, rt.extraLogins);
    const board: ProjectBoard = {
      ...base,
      projectId: rt.id,
      activity: Object.fromEntries(base.members.map((m) => [m.login, rt.activity[m.login] ?? findActivity(rt.activity, m.login)])),
      defaultBranch: await rt.ctx.store.defaultBranch(),
      pendingWrites: await rt.ctx.store.pending(),
    };
    rt.board = board;
    rt.attention = attentionCount(board, rt.ctx.me);
    await rt.ctx.saveState().catch(() => undefined);
    emit({ type: "board", data: board });
    await notifyFor(rt, board);
    return board;
  }

  function findActivity(map: Record<string, ActivityItem[]>, login: string): ActivityItem[] {
    const key = Object.keys(map).find((k) => k.toLowerCase() === login.toLowerCase());
    return key ? map[key]! : [];
  }

  async function notifyFor(rt: ProjectRuntime, board: ProjectBoard): Promise<void> {
    const app = await loadAppState();
    const fresh = computeNotifications(board, { me: rt.ctx.me, settings: app.settings, notified: new Set(app.notified) });
    if (fresh.length) {
      await updateAppState((s) => {
        s.notified.push(...fresh.map((n) => n.id));
      });
      if (rt.seeded) for (const n of fresh) emit({ type: "notify", data: n });
    }
    rt.seeded = true;
    emit({ type: "session", data: await session() });
  }

  async function syncProject(rt: ProjectRuntime): Promise<SyncState> {
    rt.sync = { state: "syncing", lastSyncAt: rt.sync.lastSyncAt };
    emit({ type: "sync", data: { ...rt.sync, projectId: rt.id } });
    try {
      const r = await syncData(rt.ctx.dataRoot, { gitEnv: rt.ctx.gitEnv });
      rt.sync =
        r.result === "conflict"
          ? { state: "conflict", message: r.message, lastSyncAt: rt.sync.lastSyncAt }
          : r.result === "offline"
            ? { state: "offline", message: r.message }
            : { state: "idle", lastSyncAt: new Date().toISOString(), message: r.message };
    } catch (e) {
      rt.sync = { state: "error", message: errMsg(e) };
    }
    emit({ type: "sync", data: { ...rt.sync, projectId: rt.id } });
    return rt.sync;
  }

  async function session(): Promise<AppSession> {
    const app = await loadAppState();
    const projects: ProjectRef[] = app.projects
      .slice()
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
      .map((p) => ({
        id: p.id,
        owner: p.owner,
        name: p.name,
        path: p.path,
        available: existsSync(path.join(p.path, ".git")),
        attention: runtimes.get(p.id)?.attention ?? 0,
      }));
    return {
      login: auth?.login ?? null,
      tokenSource: auth?.source ?? null,
      projects,
      currentProjectId: app.currentProjectId && projects.some((p) => p.id === app.currentProjectId) ? app.currentProjectId : (projects[0]?.id ?? null),
      projectsDir: app.projectsDir,
      desktop,
      version: pkg.version,
    };
  }

  /** Open every known project and refresh it, so notifications work for all of them. */
  async function refreshAll(): Promise<void> {
    if (!auth) return;
    const app = await loadAppState();
    for (const p of app.projects) {
      if (!existsSync(path.join(p.path, ".git"))) continue;
      try {
        const rt = await openRuntime(p.id);
        await syncProject(rt);
        await rebuild(rt, true);
      } catch (e) {
        info(`[${p.id}] ${errMsg(e)}`);
      }
    }
  }

  // --- long-running operations (start / new / accept) -----------------------
  function runOperation(work: (progress: (step: ProjectProgress["step"], message: string) => void) => Promise<{ projectId: string }>): string {
    const opId = randomUUID();
    const send = (p: Omit<ProjectProgress, "opId">) => emit({ type: "progress", data: { opId, ...p } });
    void (async () => {
      try {
        const r = await work((step, message) => send({ step, message }));
        send({ step: "done", message: "完成", projectId: r.projectId });
        runtimes.delete(r.projectId);
        const rt = await openRuntime(r.projectId);
        await rebuild(rt, true).catch(() => undefined);
        emit({ type: "session", data: await session() });
      } catch (e) {
        const detail = (e instanceof TandemError ? (e.details as { stderr?: string } | undefined)?.stderr : undefined) ?? undefined;
        send({ step: "done", message: "沒有完成", error: { code: errCode(e), message: errMsg(e), detail } });
      }
    })();
    return opId;
  }

  // --- HTTP -----------------------------------------------------------------
  const app = new Hono();
  let port = opts.port ?? DEFAULT_PORT;

  // --- chats with the user's own agent -------------------------------
  // A second secret, only for `tandem mcp`'s approve tool; never the session token.
  const approveToken = randomBytes(24).toString("base64url");
  const chats = new ChatManager({
    adapters: ADAPTERS,
    emit: (u) => emit({ type: "chat", data: u }),
    mcp: mcpLaunch,
    approveBridge: () => ({ url: `http://127.0.0.1:${port}/internal/approve`, token: approveToken }),
    onTurnDone: (chat, texts) => rooms.onTurnDone(chat, texts),
  });
  const roomsResumed = new Set<string>();
  const rooms: RoomManager = new RoomManager({
    chats,
    project: async (id) => {
      const rt = await openRuntime(id);
      // Rooms live in the private team data repo, never in a (possibly public) code repo.
      await requirePrivateDataRepo(rt.ctx);
      return { gh: rt.ctx.dataGh!, me: rt.ctx.me, cwd: rt.ctx.repoRoot, members: async () => (await rt.ctx.gh.listProjectMembers()).map((m) => m.login) };
    },
    agentLabel: (kind) => ({ claude: "Claude", codex: "Codex", antigravity: "Antigravity", grok: "Grok", cursor: "Cursor" })[kind] ?? kind,
  });
  const projectPathOf = async (projectId: string) => {
    const p = (await loadAppState()).projects.find((x) => x.id === projectId);
    if (!p || !existsSync(path.join(p.path, ".git"))) throw new TandemError("usage", "找不到這段對話的專案資料夾");
    return p.path;
  };

  // DNS-rebinding guard: only our own host names.
  app.use("*", async (c, next) => {
    const host = (c.req.header("host") ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return c.text("forbidden", 403);
    await next();
  });

  // Approval bridge for Claude chats. Registered before the session check: the caller
  // is `tandem mcp` inside the agent, which holds only the approve token.
  app.post("/internal/approve", async (c) => {
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const a = Buffer.from(bearer);
    const b = Buffer.from(approveToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ message: "forbidden" }, 403);
    const req = (await c.req.json().catch(() => ({}))) as { chatId?: string; toolName?: string; input?: unknown; approvalId?: string };
    try {
      let id = req.approvalId;
      let decision = id ? chats.pendingApproval(id) : undefined;
      if (!decision) {
        const r = await chats.requestApproval(String(req.chatId ?? ""), {
          name: String(req.toolName ?? "工具"),
          summary: summarizeTool(String(req.toolName ?? ""), req.input),
          input: req.input,
        });
        id = r.id;
        decision = r.decision;
      }
      const d = await Promise.race([decision, new Promise<null>((r) => setTimeout(() => r(null), 240_000))]);
      if (d === null) return c.json({ pending: true, approvalId: id });
      return c.json(d === "deny" ? { allow: false, message: "使用者拒絕了這個動作。" } : { allow: true });
    } catch (e) {
      return c.json({ allow: false, message: errMsg(e) });
    }
  });

  // The desktop main process replaces the side-panel key ("換一個網址"). Session token as Bearer only:
  // a page holding just a cookie (including the side panel itself) cannot do this.
  app.post("/internal/sidebar-key", async (c) => {
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!sameSecret(bearer, sessionToken)) return c.json({ message: "forbidden" }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { key?: unknown };
    if (typeof b.key !== "string" || b.key.length < 32) return c.json({ message: "invalid key" }, 400);
    sidebarKey = b.key;
    return c.json({ ok: true });
  });

  app.use("*", async (c, next) => {
    const t = c.req.query("t");
    if (t !== undefined) {
      const u = new URL(c.req.url);
      u.searchParams.delete("t");
      const to = `${u.pathname}${u.search}`;
      if (sameSecret(t, sessionToken)) {
        setCookie(c, COOKIE, sessionToken, { httpOnly: true, sameSite: "Strict", path: "/" });
        return c.redirect(to);
      }
      if (sameSecret(t, sidebarKey)) {
        setCookie(c, SIDEBAR_COOKIE, sidebarCookie(), { httpOnly: true, sameSite: "Strict", path: "/", maxAge: SIDEBAR_COOKIE_MAX_AGE });
        return c.redirect(to);
      }
      return c.text(`連結已失效，請重新打開 ${PRODUCT.displayName}`, 403);
    }
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const ok = getCookie(c, COOKIE) === sessionToken || bearer === sessionToken || sameSecret(getCookie(c, SIDEBAR_COOKIE), sidebarCookie());
    if (!ok) return c.text(`請從 ${PRODUCT.displayName} 打開`, 401);
    await next();
  });

  const handle =
    (fn: (c: HonoContext) => Promise<Response>) =>
    async (c: HonoContext): Promise<Response> => {
      try {
        return await fn(c);
      } catch (e) {
        const code = errCode(e);
        // Conflicts carry who changed what (e.g. a context file), so the page can say so.
        const details = code === "conflict" && e instanceof TandemError && e.details && typeof e.details === "object" ? { details: e.details } : {};
        return c.json({ error: errMsg(e), code, ...details }, httpStatus(code) as 400);
      }
    };
  const body = async <T>(c: HonoContext): Promise<Partial<T>> => ((await c.req.json().catch(() => ({}))) ?? {}) as Partial<T>;
  const projectRt = (c: HonoContext) => openRuntime(decodeURIComponent(c.req.param("id") ?? ""));

  app.get("/api/session", handle(async (c) => c.json(await session())));

  // Login
  const logins = new Map<string, { deviceCode: string; interval: number; nextPollAt: number; expiresAt: number; state: DeviceLoginState }>();
  app.post(
    "/api/login/device",
    handle(async (c) => {
      const s = await startDeviceLogin();
      const id = randomUUID();
      logins.set(id, {
        deviceCode: s.deviceCode,
        interval: s.interval,
        nextPollAt: Date.now() + s.interval * 1000,
        expiresAt: Date.now() + s.expiresIn * 1000,
        state: { state: "pending" },
      });
      return c.json({ id, userCode: s.userCode, verificationUri: s.verificationUri, expiresIn: s.expiresIn });
    }),
  );
  app.get(
    "/api/login/device/:id",
    handle(async (c) => {
      const l = logins.get(c.req.param("id") ?? "");
      if (!l) return c.json({ state: "expired" } satisfies DeviceLoginState);
      if (l.state.state !== "pending") return c.json(l.state);
      if (Date.now() > l.expiresAt) return c.json((l.state = { state: "expired" }));
      if (Date.now() < l.nextPollAt) return c.json(l.state);
      const r = await pollDeviceLogin(l.deviceCode);
      if (r.state === "slow_down") l.interval += 5;
      l.nextPollAt = Date.now() + l.interval * 1000;
      if (r.state === "done") {
        if (!saveToken(r.token)) info("無法把登入資訊存進 Windows 認證管理員，這次登入只在 app 開著時有效");
        const login = await createGitHubClient({ token: r.token, owner: "_", repo: "_" }).viewerLogin();
        auth = { token: r.token, source: "keyring", login };
        l.state = { state: "done", login };
        runtimes.clear();
        emit({ type: "session", data: await session() });
        void refreshAll();
      } else if (r.state === "expired" || r.state === "denied") l.state = { state: r.state };
      else if (r.state === "error") l.state = { state: "error", message: r.message };
      return c.json(l.state);
    }),
  );
  app.post(
    "/api/logout",
    handle(async (c) => {
      clearToken();
      for(const w of messageWorkers.values())w.close();
      messageWorkers.clear();
      runtimes.clear();
      await loadAuth(); // falls back to gh / env if present
      emit({ type: "session", data: await session() });
      return c.json({ ok: true, login: auth?.login ?? null });
    }),
  );

  // GitHub choices
  app.get(
    "/api/github/repos",
    handle(async (c) => {
      const repos = await userClient().listMyRepos({ q: c.req.query("q") });
      const app = await loadAppState();
      const local = new Map(app.projects.map((p) => [p.id, p.id]));
      return c.json(repos.map((r): RepoChoice => ({ ...r, localProjectId: local.get(projectIdFor(r.owner, r.name)) })));
    }),
  );
  app.get("/api/github/owners", handle(async (c) => c.json(await userClient().listOwners())));
  app.get(
    "/api/invitations",
    handle(async (c) => {
      const hint = (c.req.query("hint") ?? "").toLowerCase();
      const list = await userClient().listInvitations();
      const out: Invitation[] = list.map((i) => ({ ...i, hinted: !!hint && i.repo.fullName.toLowerCase() === hint }));
      out.sort((a, b) => Number(!!b.hinted) - Number(!!a.hinted));
      return c.json(out);
    }),
  );
  app.post(
    "/api/invitations/:id/accept",
    handle(async (c) => {
      const a = requireAuth();
      const id = Number(c.req.param("id"));
      const inv = (await userClient().listInvitations()).find((i) => i.id === id);
      if (!inv) throw new TandemError("usage", "找不到這個邀請，可能已經接受或過期了");
      const { projectsDir } = await loadAppState();
      const joinBody=await body<{shareToken:string;fromLink:boolean}>(c);
      const opId = runOperation((progress) =>
        joinProject({ owner: inv.repo.owner, name: inv.repo.name, token: a.token, projectsDir, invitationId: id, progress,fromLink:joinBody.fromLink===true,shareToken:joinBody.shareToken }),
      );
      return c.json({ opId });
    }),
  );

  // Projects
  app.post(
    "/api/projects",
    handle(async (c) => {
      const a = requireAuth();
      const b = await body<{ repo: string; dir: string }>(c);
      const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(b.repo ?? "");
      if (!m) throw new TandemError("usage", "請選一個 repo");
      const { projectsDir } = await loadAppState();
      const opId = runOperation((progress) =>
        startProject({ owner: m[1]!, name: m[2]!, token: a.token, projectsDir, dir: b.dir, enableDiscussions: false, progress }),
      );
      return c.json({ opId });
    }),
  );
  app.post(
    "/api/projects/new",
    handle(async (c) => {
      const a = requireAuth();
      const b = await body<{ owner: string; name: string }>(c);
      if (!b.name || !/^[A-Za-z0-9._-]{1,100}$/.test(b.name)) throw new TandemError("usage", "名稱只能用英文字母、數字、- _ .");
      const owners = await userClient().listOwners();
      const owner = owners.find((o) => o.login.toLowerCase() === (b.owner ?? a.login).toLowerCase());
      if (!owner) throw new TandemError("usage", "不能在這個帳號下建立專案");
      const { projectsDir } = await loadAppState();
      const opId = runOperation(async (progress) => {
        progress("clone", "在 GitHub 建立私人 repo");
        const created = await userClient().createRepo({ owner: owner.login, name: b.name!, isOrg: owner.kind === "org" });
        // We just created this repo for them, so turning on Discussions needs no extra question.
        return startProject({ owner: created.owner, name: created.name, token: a.token, projectsDir, enableDiscussions: true, progress });
      });
      return c.json({ opId });
    }),
  );
  app.post(
    "/api/projects/open-folder",
    handle(async (c) => {
      const a = requireAuth();
      const b = await body<{ path: string }>(c);
      if (!b.path || !existsSync(path.join(b.path, ".git"))) throw new TandemError("usage", "這個資料夾不是 git 專案（裡面沒有 .git）");
      const ctx = await openContext(b.path, { token: a.token });
      const { projectsDir } = await loadAppState();
      const opId = runOperation((progress) =>
        startProject({ owner: ctx.remote.owner, name: ctx.remote.name, token: a.token, projectsDir, dir: ctx.repoRoot, enableDiscussions: false, progress }),
      );
      return c.json({ opId, id: projectIdFor(ctx.remote.owner, ctx.remote.name) });
    }),
  );
  app.delete(
    "/api/projects/:id",
    handle(async (c) => {
      const id = decodeURIComponent(c.req.param("id") ?? "");
      runtimes.delete(id);
      await updateAppState((s) => {
        s.projects = s.projects.filter((p) => p.id !== id);
        if (s.currentProjectId === id) s.currentProjectId = s.projects[0]?.id ?? null;
      });
      emit({ type: "session", data: await session() });
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/projects/:id/select",
    handle(async (c) => {
      const id = decodeURIComponent(c.req.param("id") ?? "");
      await updateAppState((s) => {
        const p = s.projects.find((x) => x.id === id);
        if (!p) throw new TandemError("usage", "找不到這個專案");
        s.currentProjectId = id;
        p.lastOpenedAt = new Date().toISOString();
      });
      emit({ type: "session", data: await session() });
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/api/projects/:id/board",
    handle(async (c) => {
      const rt = await projectRt(c);
      // Opening a project also picks rooms this computer hosts back up, so a restart doesn't
      // leave teammates' 「問 AI」 unanswered. Needs the private data repo; skip quietly without it.
      if (!roomsResumed.has(pid(c))) {
        roomsResumed.add(pid(c));
        void rooms.resume(pid(c)).catch(() => roomsResumed.delete(pid(c)));
      }
      return c.json(rt.board ?? (await rebuild(rt, true)));
    }),
  );
  app.post("/api/projects/:id/refresh", handle(async (c) => c.json(await rebuild(await projectRt(c), true))));
  app.post(
    "/api/projects/:id/sync",
    handle(async (c) => {
      const rt = await projectRt(c);
      const s = await syncProject(rt);
      await rebuild(rt, false);
      return c.json(s);
    }),
  );
  app.post(
    "/api/projects/:id/invite",
    handle(async (c) => {
      const b = await body<{ login: string }>(c);
      if (typeof b.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(b.login.replace(/^@/, ""))) {
        throw new TandemError("usage", "請輸入正確的 GitHub 帳號");
      }
      const rt = await projectRt(c);
      return c.json(await inviteLogin(rt.ctx, b.login.replace(/^@/, "")));
    }),
  );
  app.get("/api/projects/:id/members",handle(async(c)=>c.json(await projectMembers((await projectRt(c)).ctx))));
  app.post("/api/projects/:id/share-link/reset",handle(async(c)=>{
    const b=await body<{confirm:boolean}>(c);if(b.confirm!==true)throw new TandemError("validation","請先確認要作廢舊連結");
    return c.json(await resetShareLink((await projectRt(c)).ctx));
  }));
  app.delete("/api/projects/:id/members/:login",handle(async(c)=>{
    const b=await body<{confirm:boolean}>(c);if(b.confirm!==true)throw new TandemError("validation","請先確認移除成員與資料 repo 的權限");
    const rt=await projectRt(c);const login=c.req.param("login")??"";
    if(login.toLowerCase()===rt.ctx.me.toLowerCase())throw new TandemError("validation","請使用自行離開專案");
    return c.json(await removeProjectMember(rt.ctx,login));
  }));
  app.post("/api/projects/:id/leave",handle(async(c)=>{
    const b=await body<{confirm:boolean}>(c);if(b.confirm!==true)throw new TandemError("validation","請先確認離開專案");
    const rt=await projectRt(c);messageWorker(rt).close();
    const result=await removeProjectMember(rt.ctx,rt.ctx.me,true);
    if(result.complete){runtimes.delete(rt.id);await updateAppState(s=>{s.projects=s.projects.filter(p=>p.id!==rt.id);if(s.currentProjectId===rt.id)s.currentProjectId=s.projects[0]?.id??null;});emit({type:"session",data:await session()});}
    return c.json(result);
  }));
  app.get("/api/projects/:id/agent-messages", handle(async(c)=>{
    const {ctx}=await projectRt(c); requirePrivateMessages(ctx.dataRepo.separate);
    return c.json({settings:await localAgentSettings(ctx),members:await agentMembers(ctx.store,projectKey(ctx)),messages:await listAgentMessages(ctx.store,projectKey(ctx),ctx.me)});
  }));
  app.put("/api/projects/:id/agent-messages/settings", handle(async(c)=>{
    const rt=await projectRt(c); const r=await saveAgentSettings(rt.ctx,await body<unknown>(c));
    if(!r.settings.enabled) messageWorker(rt).close();
    else void messageWorker(rt).tick(rt.ctx).catch(()=>undefined);
    return c.json(r);
  }));
  app.post("/api/projects/:id/agent-messages",handle(async(c)=>{
    const {ctx}=await projectRt(c); const b=await body<{to:string;text:string}>(c);
    await requirePrivateDataRepo(ctx);
    return c.json(await sendAgentMessage(ctx.store,{to:typeof b.to==="string"?b.to:"",text:typeof b.text==="string"?b.text:"",project:projectKey(ctx),me:ctx.me,separate:ctx.dataRepo.separate}));
  }));
  app.post("/api/projects/:id/agent-messages/:message/:action",handle(async(c)=>{
    const rt=await projectRt(c);requirePrivateMessages(rt.ctx.dataRepo.separate);
    const action=c.req.param("action");if(action!=="stop"&&action!=="archive") throw new TandemError("usage","找不到這個操作");
    const id=c.req.param("message")??"";await changeAgentMessage(rt.ctx.store,projectKey(rt.ctx),rt.ctx.me,id,action);
    if(action==="stop") messageWorker(rt).stop(id);
    return c.json({ok:true});
  }));
  app.get("/api/projects/:id/local-transcripts",handle(async(c)=>{
    const {ctx}=await projectRt(c);requirePrivateMessages(ctx.dataRepo.separate);
    return c.json(await projectTranscripts(ctx.repoRoot,{project:projectKey(ctx)}));
  }));

  app.get("/api/projects/:id/shared-chats",handle(async(c)=>{
    const {ctx}=await projectRt(c);requirePrivateMessages(ctx.dataRepo.separate);
    return c.json({settings:await sharingSettings(ctx),chats:await sharedChats(ctx.store,projectKey(ctx)),handoffs:await listHandoffs(ctx)});
  }));
  app.post("/api/projects/:id/shared-chats/preview",handle(async(c)=>{
    const {ctx}=await projectRt(c);const b=await body<{ids:string[]}>(c);return c.json(await previewSharing(ctx,b.ids??[]));
  }));
  app.post("/api/projects/:id/shared-chats/confirm",handle(async(c)=>{
    const {ctx}=await projectRt(c);const b=await body<{token:string}>(c);return c.json(await confirmSharing(ctx,b.token??""));
  }));
  app.post("/api/projects/:id/shared-chats/stop",handle(async(c)=>c.json(await stopSharing((await projectRt(c)).ctx))));
  app.post("/api/projects/:id/shared-chats/fork",handle(async(c)=>{
    const rt=await projectRt(c);const b=await body<{owner:string;id:string;provider:string;model:string}>(c);
    if(b.provider!=="claude"&&b.provider!=="codex")throw new TandemError("validation","請選擇接續對話要用的工具");
    const source=await sharedChatFor(rt.ctx,b.owner??"",b.id??"");
    return c.json(await chats.forkShared(rt.id,b.provider,typeof b.model==="string"?b.model:"",source));
  }));
  app.post("/api/projects/:id/handoffs",handle(async(c)=>{
    const rt=await projectRt(c);const b=await body<{task:number;to:string;note:string;confirm:boolean}>(c);
    if(b.confirm!==true)throw new TandemError("validation","請先確認任務、接手人與交接筆記");
    const r=await createHandoff(rt.ctx,{task:b.task??0,to:b.to??"",note:b.note??""});await rebuild(rt,true);return c.json(r);
  }));

  // Shared context (tandem/context/ in the data repo). Paths are relative to that folder.
  app.get("/api/projects/:id/context", handle(async (c) => {
    const { ctx } = await projectRt(c);
    return c.json(await listContext(ctx.store, ctx.self));
  }));
  app.get(
    "/api/projects/:id/context/file",
    handle(async (c) => {
      const f = await readContext((await projectRt(c)).ctx.store, c.req.query("path") ?? "");
      if (!f) throw new TandemError("usage", "找不到這個檔案，可能已經被刪掉了");
      return c.json(f);
    }),
  );
  app.put(
    "/api/projects/:id/context/file",
    handle(async (c) => {
      const b = await body<ContextWriteInput>(c);
      const rt = await projectRt(c);
      const r = await writeContext(
        rt.ctx.store,
        {
          path: String(b.path ?? ""),
          content: typeof b.content === "string" ? b.content : "",
          ...(b.encoding ? { encoding: b.encoding } : {}),
          ...(b.expectVersion !== undefined ? { expectVersion: b.expectVersion } : {}),
          ...(typeof b.why === "string" ? { why: b.why } : {}),
        },
        { me: rt.ctx.me },
      );
      return c.json(r);
    }),
  );
  app.delete(
    "/api/projects/:id/context/file",
    handle(async (c) => {
      const rt = await projectRt(c);
      const v = c.req.query("expectVersion");
      return c.json(await deleteContext(rt.ctx.store, c.req.query("path") ?? "", { me: rt.ctx.me, ...(v ? { expectVersion: v } : {}) }));
    }),
  );
  app.get("/api/agents", handle(async (c) => c.json(await agentStatuses(c.req.query("refresh") === "1"))));
  app.post(
    "/api/agents/:kind/login",
    handle(async (c) => {
      const kind = c.req.param("kind") as AgentKind;
      const adapter = ADAPTERS[kind];
      if (!Object.hasOwn(ADAPTERS, kind)) throw new TandemError("usage", "不認得這個 agent");
      const b = await body<{ method: "subscription" | "apiKey" }>(c);
      const r = await adapter.login(b.method === "apiKey" ? "apiKey" : "subscription", os.homedir());
      return c.json(r);
    }),
  );
  app.post(
    "/api/agents/:kind/logout",
    handle(async (c) => {
      const adapter = ADAPTERS[c.req.param("kind") as AgentKind];
      if (!Object.hasOwn(ADAPTERS, c.req.param("kind") ?? "")) throw new TandemError("usage", "不認得這個 agent");
      await adapter.logout();
      const data = await agentStatuses(true);
      emit({ type: "agents", data });
      return c.json(data);
    }),
  );

  // Chats
  app.get("/api/projects/:id/chats", handle(async (c) => c.json(await chats.list(decodeURIComponent(c.req.param("id") ?? "")))));
  app.post(
    "/api/projects/:id/chats",
    handle(async (c) => {
      const id = decodeURIComponent(c.req.param("id") ?? "");
      await projectPathOf(id);
      const b = await body<{ agent: AgentKind; model: string }>(c);
      if (typeof b.agent !== "string" || !Object.hasOwn(ADAPTERS, b.agent)) throw new TandemError("usage", "請選一個 agent");
      return c.json(await chats.create(id, b.agent, typeof b.model === "string" ? b.model : ""));
    }),
  );
  app.get("/api/chats/:chatId", handle(async (c) => c.json(await chats.get(c.req.param("chatId") ?? ""))));
  app.patch(
    "/api/chats/:chatId",
    handle(async (c) => {
      const chat = await chats.get(c.req.param("chatId") ?? "");
      const b = await body<{ model: string; reasoningEffort?: string }>(c);
      if (typeof b.model !== "string" || (b.reasoningEffort !== undefined && typeof b.reasoningEffort !== "string")) throw new TandemError("usage", "模型設定不正確");
      const status = (await agentStatuses()).find((a) => a.agent === chat.agent);
      const model = status?.models.find((m) => m.id === b.model);
      if (!model) throw new TandemError("usage", "請選一個可用的模型");
      if (b.reasoningEffort && !model.reasoningEfforts?.includes(b.reasoningEffort)) throw new TandemError("usage", "這個模型不支援所選的 effort");
      return c.json(await chats.configure(chat.id, b.model, b.reasoningEffort || undefined));
    }),
  );
  app.post(
    "/api/chats/:chatId/messages",
    handle(async (c) => {
      const chat = await chats.get(c.req.param("chatId") ?? "");
      const b = await body<{ text: string; images?: unknown; mode?: string }>(c);
      if (b.mode && !["send", "steer", "queue"].includes(b.mode)) throw new TandemError("usage", "不認得這個送出方式");
      const text = String(b.text ?? "");
      const cwd = await projectPathOf(chat.projectId);
      if (b.mode === "steer") await chats.steer(chat.id, text, b.images);
      else if (b.mode === "queue") await chats.enqueue(chat.id, text, cwd, b.images);
      else await chats.send(chat.id, text, cwd, b.images);
      return c.json({ ok: true });
    }),
  );
  app.post("/api/chats/:chatId/queue/resume", handle(async (c) => {
    const chat = await chats.get(c.req.param("chatId") ?? "");
    await chats.resumeQueue(chat.id, await projectPathOf(chat.projectId));
    return c.json({ ok: true });
  }));
  app.patch("/api/chats/:chatId/queue/:messageId", handle(async (c) => {
    const b = await body<{ text: string; images?: unknown }>(c);
    if (typeof b.text !== "string") throw new TandemError("usage", "訊息格式不正確");
    await chats.updateQueued(c.req.param("chatId") ?? "", c.req.param("messageId") ?? "", { text: b.text, images: b.images });
    return c.json({ ok: true });
  }));
  app.delete("/api/chats/:chatId/queue/:messageId", handle(async (c) => {
    await chats.updateQueued(c.req.param("chatId") ?? "", c.req.param("messageId") ?? "");
    return c.json({ ok: true });
  }));
  app.post(
    "/api/chats/:chatId/interrupt",
    handle(async (c) => {
      await chats.interrupt(c.req.param("chatId") ?? "");
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/chats/:chatId/approvals/:approvalId",
    handle(async (c) => {
      const b = await body<{ decision: ApprovalDecision }>(c);
      if (b.decision !== "allow" && b.decision !== "allowSession" && b.decision !== "deny") throw new TandemError("usage", "不認得這個選擇");
      await chats.answer(c.req.param("chatId") ?? "", c.req.param("approvalId") ?? "", b.decision);
      return c.json({ ok: true });
    }),
  );
  app.delete(
    "/api/chats/:chatId",
    handle(async (c) => {
      await chats.remove(c.req.param("chatId") ?? "");
      return c.json({ ok: true });
    }),
  );
  // Rooms
  const roomNo = (c: HonoContext) => {
    const n = Number(c.req.param("n"));
    if (!Number.isInteger(n) || n <= 0) throw new TandemError("usage", "房間編號不對");
    return n;
  };
  const pid = (c: HonoContext) => decodeURIComponent(c.req.param("id") ?? "");
  app.get("/api/projects/:id/rooms", handle(async (c) => c.json(await rooms.list(pid(c)))));
  app.post(
    "/api/projects/:id/rooms",
    handle(async (c) => {
      const b = await body<{ title: string; agent: AgentKind; model: string }>(c);
      if (typeof b.agent !== "string" || !Object.hasOwn(ADAPTERS, b.agent)) throw new TandemError("usage", "請選一個 agent");
      return c.json(await rooms.create(pid(c), String(b.title ?? ""), b.agent, typeof b.model === "string" ? b.model : ""));
    }),
  );
  app.get("/api/projects/:id/rooms/:n", handle(async (c) => c.json(await rooms.get(pid(c), roomNo(c)))));
  app.post(
    "/api/projects/:id/rooms/:n/messages",
    handle(async (c) => {
      const b = await body<{ text: string; ask?: boolean }>(c);
      await rooms.post(pid(c), roomNo(c), String(b.text ?? ""), b.ask === true);
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/projects/:id/rooms/:n/notes",
    handle(async (c) => {
      const b = await body<{ end?: boolean }>(c);
      await rooms.notes(pid(c), roomNo(c), !!b.end);
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/projects/:id/open-agent",
    handle(async (c) => {
      const b = await body<{ agent: AgentKind }>(c);
      if (typeof b.agent !== "string" || !Object.hasOwn(ADAPTERS, b.agent)) throw new TandemError("usage", "不認得這個 agent");
      const rt = await projectRt(c);
      openAgent(b.agent, rt.ctx.repoRoot);
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/projects/:id/open-folder",
    handle(async (c) => {
      const rt = await projectRt(c);
      openFolder(rt.ctx.repoRoot);
      return c.json({ ok: true });
    }),
  );

  // Settings
  app.get("/api/settings", handle(async (c) => c.json((await loadAppState()).settings)));
  app.put(
    "/api/settings",
    handle(async (c) => {
      const b = await body<AppSettings>(c);
      const s = await updateAppState((st) => {
        if (b.notifications) {
          for (const k of ["waiting", "review", "task"] as const) {
            if (typeof b.notifications[k] === "boolean") st.settings.notifications[k] = b.notifications[k];
          }
        }
        if (typeof b.openAtLogin === "boolean") st.settings.openAtLogin = b.openAtLogin;
      });
      return c.json(s.settings);
    }),
  );

  // Events
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (e: AppEvent) => void stream.writeSSE({ event: e.type, data: JSON.stringify(e.data) });
      listeners.add(send);
      send({ type: "session", data: await session() });
      const keepAlive = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 25_000);
      await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
      clearInterval(keepAlive);
      listeners.delete(send);
    }),
  );

  // Static client
  const dir = clientDir();
  app.get("*", async (c) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(dir, rel);
    const target = file.startsWith(path.resolve(dir)) && existsSync(file) && !file.endsWith(path.sep) ? file : path.join(dir, "index.html");
    if (!existsSync(target)) return c.text("看板介面還沒建置，請先執行 npm run build", 500);
    return c.body(await readFile(target), 200, { "content-type": MIME[path.extname(target)] ?? "application/octet-stream" });
  });

  // --- start ----------------------------------------------------------------
  await loadAuth();
  const startAuth = auth as { token: string } | null;
  if (opts.cwd && startAuth) {
    // Started inside a repo: make it a known project and show it first.
    try {
      const ctx = await openContext(opts.cwd, { token: startAuth.token });
      await rememberProject(ctx);
    } catch {
      /* not a GitHub repo: just show the picker */
    }
  }

  let server: ServerType | undefined;
  // The desktop app asks for a fixed port so the side-panel address stays the same; when that port
  // and the next few are taken it still starts, on a random port.
  const tryPorts = opts.port === 0 ? [0] : [...Array.from({ length: PORT_TRIES }, (_, i) => port + i), ...(desktop ? [0] : [])];
  for (const p of tryPorts) {
    server = await new Promise<ServerType | undefined>((resolve) => {
      const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: p }, (addr) => {
        port = addr.port;
        resolve(s);
      });
      s.once("error", () => resolve(undefined));
    });
    if (server) break;
  }
  if (!server) throw new TandemError("internal", "找不到可用的連接埠");

  const base = `http://127.0.0.1:${port}/`;
  const url = `${base}?t=${sessionToken}`;
  if (opts.readyLine) process.stdout.write(`${JSON.stringify({ ready: true, port, url: base })}\n`);
  else {
    info(`看板：${url}`);
    info("按 Ctrl+C 結束。");
  }
  if (opts.openBrowser !== false && !desktop) await open(url).catch(() => undefined);

  void refreshAll();
  const poll = setInterval(() => void refreshAll(), GITHUB_POLL_MS);
  const messagePoll = setInterval(()=>{for(const rt of runtimes.values()) void messageWorker(rt).tick(rt.ctx).catch(()=>undefined);},15_000);
  const sharePoll=setInterval(()=>{for(const rt of runtimes.values())void syncSharedChats(rt.ctx).catch(()=>undefined);},30_000);

  const close = async () => {
    clearInterval(poll);
    clearInterval(messagePoll);
    clearInterval(sharePoll);
    for(const w of messageWorkers.values()) w.close();
    rooms.closeAll();
    await chats.closeAll();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  };
  process.once("SIGINT", () => void close().then(() => process.exit(0)));
  process.once("SIGTERM", () => void close().then(() => process.exit(0)));
  return { url, port, close };
}

// ---------------------------------------------------------------------------
// Agents and folders
// ---------------------------------------------------------------------------
const INSTALL_URLS: Record<AgentKind, string> = {
  claude: "https://code.claude.com/docs/en/setup",
  codex: "https://developers.openai.com/codex",
  grok: ACP_INFO.grok.installUrl,
  cursor: ACP_INFO.cursor.installUrl,
  antigravity: ACP_INFO.antigravity.installUrl,
};

/** How the agent starts `tandem mcp`: this same program, so it works before PATH is updated (desktop). */
function mcpLaunch(): McpLaunch {
  return {
    command: process.execPath,
    args: [process.argv[1]!, "mcp"],
    env: process.env.ELECTRON_RUN_AS_NODE ? { ELECTRON_RUN_AS_NODE: "1" } : {},
  };
}

function summarizeTool(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  for (const k of ["command", "file_path", "path", "notebook_path", "url", "pattern", "title"]) {
    if (typeof i[k] === "string" && i[k]) return String(i[k]).replace(/\s+/g, " ").slice(0, 160);
  }
  return name.startsWith("mcp__") ? name.split("__").slice(1).join(" · ") : "";
}

function onPath(cmd: string): boolean {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore", windowsHide: true });
  return r.status === 0;
}

export function detectAgents(): AgentAvailability[] {
  return (Object.keys(INSTALL_URLS) as AgentKind[]).map((agent) => ({ agent, installed: onPath(agent === "cursor" ? "cursor-agent" : agent === "antigravity" ? "agy" : agent), installUrl: INSTALL_URLS[agent] }));
}

/** Open the user's own agent in a terminal at `dir`. Arguments are passed as an array, never a shell string. */
function openAgent(agent: AgentKind, dir: string): void {
  const command = agent === "cursor" ? "cursor-agent" : agent === "antigravity" ? "agy" : agent;
  if (!onPath(command)) throw new TandemError("usage", `這台電腦還沒安裝 ${command} 終端機工具`);
  const detached = { detached: true, stdio: "ignore" as const, windowsHide: false };
  if (process.platform === "win32") {
    if (onPath("wt")) {
      spawn("wt.exe", ["-d", dir, command], detached).unref();
      return;
    }
    // PowerShell fallback: the folder is passed as an argument, not interpolated into the command.
    spawn(
      "powershell.exe",
      ["-NoExit", "-Command", `Set-Location -LiteralPath $args[0]; ${command}`, dir],
      { ...detached, shell: false },
    ).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", ["-a", "Terminal", dir], detached).unref();
    return;
  }
  throw new TandemError("usage", "這個系統還不支援從 app 打開 agent");
}

function openFolder(dir: string): void {
  const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
}
