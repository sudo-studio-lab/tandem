/**
 * Local app server (002 plan §伺服器 API): one process serves every project on this computer.
 * Used by `tandem` (browser) and by the desktop app (`tandem serve`, research S9).
 * Binds 127.0.0.1 only; a one-time token becomes a cookie (001 R13); the desktop main process
 * may also send it as a Bearer header. Updates go out over Server-Sent Events.
 */
import { randomBytes, randomUUID } from "node:crypto";
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
  type AppEvent,
  type AppSession,
  type AppSettings,
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
  syncData,
  updateAppState,
} from "@tandem/core";
import { openContext, type Context } from "./context.ts";
import { buildBoard, gatherGitHub, type GitHubData } from "./gather.ts";
import { inviteLogin } from "./commands.ts";
import { info } from "./io.ts";
import { rememberProject, startProject, joinProject } from "./setup.ts";
import pkg from "../package.json" with { type: "json" };

const DEFAULT_PORT = 4318;
const GITHUB_POLL_MS = 3 * 60_000;
const COOKIE = "tandem_session";
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
  code === "usage" || code === "validation" ? 400 : code === "auth" ? 401 : code === "needs_human" ? 403 : code === "offline" ? 503 : 500;

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
}

export interface AppServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions = {}): Promise<AppServer> {
  const sessionToken = opts.sessionToken ?? randomBytes(24).toString("base64url");
  const desktop = !!opts.desktop;
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
      const r = await syncData(rt.ctx.repoRoot, { gitEnv: rt.ctx.gitEnv });
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

  // DNS-rebinding guard: only our own host names.
  app.use("*", async (c, next) => {
    const host = (c.req.header("host") ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return c.text("forbidden", 403);
    await next();
  });
  app.use("*", async (c, next) => {
    const t = c.req.query("t");
    if (t !== undefined) {
      if (t !== sessionToken) return c.text(`連結已失效，請重新打開 ${PRODUCT.displayName}`, 403);
      setCookie(c, COOKIE, sessionToken, { httpOnly: true, sameSite: "Strict", path: "/" });
      const u = new URL(c.req.url);
      u.searchParams.delete("t");
      return c.redirect(`${u.pathname}${u.search}`);
    }
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (getCookie(c, COOKIE) !== sessionToken && bearer !== sessionToken) return c.text(`請從 ${PRODUCT.displayName} 打開`, 401);
    await next();
  });

  const handle =
    (fn: (c: HonoContext) => Promise<Response>) =>
    async (c: HonoContext): Promise<Response> => {
      try {
        return await fn(c);
      } catch (e) {
        const code = errCode(e);
        return c.json({ error: errMsg(e), code }, httpStatus(code) as 400);
      }
    };
  const body = async <T>(c: HonoContext): Promise<Partial<T>> => ((await c.req.json().catch(() => ({}))) ?? {}) as Partial<T>;
  const projectRt = (c: HonoContext) => openRuntime(decodeURIComponent(c.req.param("id") ?? ""));

  app.get("/api/session", handle(async (c) => c.json(await session())));

  // Login (research S5)
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
      const opId = runOperation((progress) =>
        joinProject({ owner: inv.repo.owner, name: inv.repo.name, token: a.token, projectsDir, invitationId: id, progress }),
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
  app.get("/api/agents", handle(async (c) => c.json(detectAgents())));
  app.post(
    "/api/projects/:id/open-agent",
    handle(async (c) => {
      const b = await body<{ agent: AgentKind }>(c);
      if (b.agent !== "claude" && b.agent !== "codex") throw new TandemError("usage", "不認得這個 agent");
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
  const tryPorts = opts.port === 0 ? [0] : Array.from({ length: 20 }, (_, i) => port + i);
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

  const close = async () => {
    clearInterval(poll);
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  };
  process.once("SIGINT", () => void close().then(() => process.exit(0)));
  process.once("SIGTERM", () => void close().then(() => process.exit(0)));
  return { url, port, close };
}

// ---------------------------------------------------------------------------
// Agents and folders (research S10)
// ---------------------------------------------------------------------------
const INSTALL_URLS: Record<AgentKind, string> = {
  claude: "https://code.claude.com/docs/en/setup",
  codex: "https://developers.openai.com/codex",
};

function onPath(cmd: string): boolean {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore", windowsHide: true });
  return r.status === 0;
}

export function detectAgents(): AgentAvailability[] {
  return (["claude", "codex"] as const).map((agent) => ({ agent, installed: onPath(agent), installUrl: INSTALL_URLS[agent] }));
}

/** Open the user's own agent in a terminal at `dir`. Arguments are passed as an array, never a shell string. */
function openAgent(agent: AgentKind, dir: string): void {
  if (!onPath(agent)) throw new TandemError("usage", `這台電腦還沒安裝 ${agent === "claude" ? "Claude Code" : "Codex"}`);
  const detached = { detached: true, stdio: "ignore" as const, windowsHide: false };
  if (process.platform === "win32") {
    if (onPath("wt")) {
      spawn("wt.exe", ["-d", dir, agent], detached).unref();
      return;
    }
    // PowerShell fallback: the folder is passed as an argument, not interpolated into the command.
    spawn(
      "powershell.exe",
      ["-NoExit", "-Command", `Set-Location -LiteralPath $args[0]; ${agent}`, dir],
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
