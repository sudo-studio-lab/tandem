/**
 * Local board server (research R12, R13): binds 127.0.0.1 only, one-time token → cookie,
 * serves the web UI and /api/*, pushes updates over Server-Sent Events.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import open from "open";
import { PRODUCT, TandemError, type BoardData, type SyncState } from "@tandem/contracts";
import { createSyncScheduler, syncData } from "@tandem/core";
import { openContext, type Context } from "./context.ts";
import { buildBoard, gatherGitHub, type GitHubData } from "./gather.ts";
import { inviteLogin } from "./commands.ts";
import { info } from "./io.ts";

const DEFAULT_PORT = 4318;
const GITHUB_POLL_MS = 3 * 60_000;
const COOKIE = "tandem_session";

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
  // Bundled: dist/bin.js + dist/client. Dev (tsx/vitest): apps/cli/src → apps/web/dist.
  const candidates = [path.join(here, "client"), path.resolve(here, "../../web/dist")];
  return candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[0]!;
}

export interface BoardServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startBoard(opts: { cwd?: string; port?: number; openBrowser?: boolean } = {}): Promise<BoardServer> {
  const ctx: Context = await openContext(opts.cwd);
  const token = randomBytes(24).toString("base64url");
  let sync: SyncState = { state: "idle" };
  let gh: GitHubData = { discussions: [], pullRequests: [], tasks: [], problems: [] };
  let board: BoardData | null = null;
  const listeners = new Set<(event: string, data: unknown) => void>();
  const emit = (event: string, data: unknown) => listeners.forEach((l) => l(event, data));

  const rebuild = async (refreshGitHub: boolean) => {
    if (refreshGitHub) gh = await gatherGitHub(ctx);
    board = await buildBoard(ctx, gh, sync);
    await ctx.saveState().catch(() => undefined);
    emit("board", board);
    return board;
  };

  const scheduler = createSyncScheduler(ctx.repoRoot, {
    dataDir: PRODUCT.dataDir,
    onState: (s) => {
      sync = s;
      emit("sync", s);
      if (s.state === "idle") void rebuild(false).catch(() => undefined);
    },
  });
  const poll = setInterval(() => void rebuild(true).catch(() => undefined), GITHUB_POLL_MS);
  await rebuild(true);

  const app = new Hono();
  let port = opts.port ?? DEFAULT_PORT;

  // DNS-rebinding guard: only accept our own host names.
  app.use("*", async (c, next) => {
    const host = (c.req.header("host") ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return c.text("forbidden", 403);
    await next();
  });

  app.use("*", async (c, next) => {
    const t = c.req.query("t");
    if (t !== undefined) {
      if (t !== token) return c.text("連結已失效，請重新執行 tandem", 403);
      setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Strict", path: "/" });
      return c.redirect("/");
    }
    if (getCookie(c, COOKIE) !== token) return c.text(`請用 ${PRODUCT.command} 打開看板`, 401);
    await next();
  });

  app.get("/api/board", async (c) => c.json(board ?? (await rebuild(false))));
  app.post("/api/refresh", async (c) => c.json(await rebuild(true)));
  app.post("/api/sync", async (c) => {
    sync = { state: "syncing" };
    emit("sync", sync);
    const r = await syncData(ctx.repoRoot, { dataDir: PRODUCT.dataDir });
    sync =
      r.result === "conflict"
        ? { state: "conflict", message: r.message, lastSyncAt: sync.lastSyncAt }
        : r.result === "offline"
          ? { state: "offline", message: r.message }
          : { state: "idle", lastSyncAt: new Date().toISOString() };
    emit("sync", sync);
    scheduler.trigger();
    await rebuild(false);
    return c.json(sync);
  });
  app.post("/api/invite", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { login?: unknown };
    if (typeof body.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(body.login)) {
      return c.json({ error: "請輸入正確的 GitHub 帳號", code: "usage" }, 400);
    }
    try {
      return c.json(await inviteLogin(ctx, body.login));
    } catch (e) {
      const code = e instanceof TandemError ? e.code : "internal";
      return c.json({ error: e instanceof Error ? e.message : String(e), code }, code === "needs_human" ? 403 : 500);
    }
  });
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) => void stream.writeSSE({ event, data: JSON.stringify(data) });
      listeners.add(send);
      send("sync", sync);
      if (board) send("board", board);
      const keepAlive = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 25_000);
      await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
      clearInterval(keepAlive);
      listeners.delete(send);
    }),
  );

  const dir = clientDir();
  app.get("*", async (c) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(dir, rel);
    const target = file.startsWith(path.resolve(dir)) && existsSync(file) && !file.endsWith(path.sep) ? file : path.join(dir, "index.html");
    if (!existsSync(target)) return c.text("看板介面還沒建置，請先執行 npm run build", 500);
    const body = await readFile(target);
    return c.body(body, 200, { "content-type": MIME[path.extname(target)] ?? "application/octet-stream" });
  });

  // Find a free port starting at the default.
  let server: ServerType | undefined;
  for (let attempt = 0; attempt < 20 && !server; attempt++) {
    server = await new Promise<ServerType | undefined>((resolve) => {
      const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => resolve(s));
      s.once("error", () => resolve(undefined));
    });
    if (!server) port++;
  }
  if (!server) throw new TandemError("internal", "找不到可用的連接埠");

  const url = `http://127.0.0.1:${port}/?t=${token}`;
  info(`看板：${url}`);
  info("按 Ctrl+C 結束。");
  if (opts.openBrowser !== false) await open(url).catch(() => undefined);

  const close = async () => {
    clearInterval(poll);
    scheduler.stop();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  };
  process.once("SIGINT", () => void close().then(() => process.exit(0)));
  return { url, port, close };
}
