import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { startServer, type AppServer } from "./server.ts";
import { readLines } from "./main.ts";

vi.mock("@tandem/core", async (original) => ({
  ...(await original<any>()),
  getGitHubToken: async () => ({ token: "fixture-only", source: "env" }),
  createGitHubClient: () => ({ viewerLogin: async () => "alice" }),
}));

const SESSION = "fixture-session";
const KEY = "k".repeat(43);
let home = "";
let previousHome: string | undefined;
const open: AppServer[] = [];

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "tandem-sidebar-"));
  previousHome = process.env.TANDEM_HOME;
  process.env.TANDEM_HOME = home;
});
afterAll(async () => {
  for (const s of open) await s.close().catch(() => undefined);
  if (previousHome === undefined) delete process.env.TANDEM_HOME;
  else process.env.TANDEM_HOME = previousHome;
  await fs.rm(home, { recursive: true, force: true });
});

async function start(opts: Parameters<typeof startServer>[0]): Promise<AppServer> {
  const s = await startServer({ openBrowser: false, desktop: true, sessionToken: SESSION, ...opts });
  open.push(s);
  return s;
}

/** GET without following redirects; returns status, the side-panel cookie (if set) and its Max-Age. */
async function get(base: string, route: string, headers: Record<string, string> = {}) {
  const r = await fetch(base + route, { headers, redirect: "manual" });
  const set = r.headers.getSetCookie().find((c) => c.startsWith("tandem_sidebar="));
  return { status: r.status, location: r.headers.get("location"), cookie: set?.split(";")[0], setCookie: set };
}

it("swaps the side-panel key for a year-long cookie that survives a restart and ends when the key is replaced", async () => {
  const a = await start({ port: 0, sidebarKey: KEY });
  const base = `http://127.0.0.1:${a.port}`;

  // Without anything: not allowed. A wrong key: the link has expired.
  expect((await get(base, "/api/settings")).status).toBe(401);
  expect((await get(base, `/?t=${"x".repeat(43)}`)).status).toBe(403);

  const swap = await get(base, `/?t=${KEY}`);
  expect(swap.status).toBe(302);
  expect(swap.location).toBe("/");
  expect(swap.setCookie).toMatch(/Max-Age=31536000/);
  expect(swap.setCookie).toMatch(/HttpOnly/);
  expect(swap.cookie).toBeDefined();
  // The cookie holds a value derived from the key, never the key itself.
  expect(swap.cookie).not.toContain(KEY);
  expect((await get(base, "/api/settings", { cookie: swap.cookie! })).status).toBe(200);

  // App restarts (or updates): a new server with the same key accepts the same cookie.
  const b = await start({ port: 0, sidebarKey: KEY });
  const baseB = `http://127.0.0.1:${b.port}`;
  expect((await get(baseB, "/api/settings", { cookie: swap.cookie! })).status).toBe(200);

  // Only the session token as Bearer may replace the key; a cookie holder may not.
  const post = (headers: Record<string, string>, key: string) =>
    fetch(baseB + "/internal/sidebar-key", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ key }) });
  expect((await post({ cookie: swap.cookie! }, "n".repeat(43))).status).toBe(403);
  expect((await post({ authorization: `Bearer ${SESSION}` }, "short")).status).toBe(400);
  expect((await post({ authorization: `Bearer ${SESSION}` }, "n".repeat(43))).status).toBe(200);

  // Old cookie and old address stop working at once; the new address works.
  expect((await get(baseB, "/api/settings", { cookie: swap.cookie! })).status).toBe(401);
  expect((await get(baseB, `/?t=${KEY}`)).status).toBe(403);
  const fresh = await get(baseB, `/?t=${"n".repeat(43)}`);
  expect(fresh.status).toBe(302);
  expect((await get(baseB, "/api/settings", { cookie: fresh.cookie! })).status).toBe(200);
});

it("keeps the session token working and refuses other host names", async () => {
  const s = await start({ port: 0, sidebarKey: KEY });
  const base = `http://127.0.0.1:${s.port}`;
  expect((await get(base, "/api/settings", { authorization: `Bearer ${SESSION}` })).status).toBe(200);
  const swap = await fetch(`${base}/?t=${SESSION}`, { redirect: "manual" });
  expect(swap.status).toBe(302);
  expect(swap.headers.getSetCookie().some((c) => c.startsWith("tandem_session="))).toBe(true);
  // DNS rebinding: a page on another name that resolves to 127.0.0.1 gets nothing.
  const evil = await new Promise<number>((resolve, reject) => {
    const sock = net.connect(s.port, "127.0.0.1", () => {
      sock.write(`GET /?t=${KEY} HTTP/1.1\r\nHost: evil.example:${s.port}\r\nConnection: close\r\n\r\n`);
    });
    let buf = "";
    sock.on("data", (d) => (buf += d.toString()));
    sock.on("end", () => resolve(Number(buf.split(" ")[1])));
    sock.on("error", reject);
  });
  expect(evil).toBe(403);
});

it("without a key, a side-panel cookie is never accepted", async () => {
  const s = await start({ port: 0 });
  const base = `http://127.0.0.1:${s.port}`;
  expect((await get(base, "/?t=")).status).toBe(403);
  expect((await get(base, "/api/settings", { cookie: "tandem_sidebar=" })).status).toBe(401);
});

it("prefers the asked port, then the next ones, then any free port (desktop)", async () => {
  // Find a free base port, then hold it and the 19 after it.
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const basePort = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const held: net.Server[] = [];
  for (let p = basePort; p < basePort + 20; p++) {
    const h = net.createServer();
    await new Promise<void>((r) => {
      h.once("error", () => r());
      h.listen(p, "127.0.0.1", () => {
        held.push(h);
        r();
      });
    });
  }
  try {
    const s = await start({ port: basePort, sidebarKey: KEY });
    expect(s.port < basePort || s.port >= basePort + 20).toBe(true);
  } finally {
    for (const h of held) await new Promise<void>((r) => h.close(() => r()));
  }
});

it("reads the session token and the side-panel key from stdin, even when they arrive together", async () => {
  const input = new PassThrough();
  const lines = readLines(2, input);
  input.write(`${SESSION}\n${KEY}\n`);
  expect(await lines).toEqual([SESSION, KEY]);

  const split = new PassThrough();
  const later = readLines(2, split);
  split.write(`${SESSION}\n`);
  split.write(`${KEY}\r\n`);
  expect(await later).toEqual([SESSION, KEY]);
});
