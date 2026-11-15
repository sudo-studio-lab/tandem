import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import type { AppEvent, AppNotification } from "@tandem/contracts";
import { Backend } from "./backend.ts";
import { findDeepLink, isHttps, parseJoinLink } from "./deeplink.ts";
import { EventStream } from "./events.ts";
import { cliPath, gitExe, iconPath } from "./paths.ts";
import { defaultBinDir, ensureShim } from "./shim.ts";
import { startStub } from "./stub.ts";
import { readState, writeState } from "./state.ts";
import { startUpdater } from "./updater.ts";

const APP_ID = "com.sudo-studio-lab.tandem";
const startHidden = process.argv.includes("--hidden");

app.setAppUserModelId(APP_ID);

const token = randomBytes(32).toString("base64url");
let backend: Backend | null = null;
let origin = "";
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let attention = 0;
let pendingJoin: string | null = null;
let serverError: string | null = null;
const events = new EventStream(onAppEvent, (m) => backend?.note(m));
const notified = new Set<string>();

// ---------------------------------------------------------------------------
// Single instance + tandem:// links
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const link = findDeepLink(argv);
    if (link) handleLink(link);
    showWindow();
  });
  void app.whenReady().then(boot);
}

if (app.isPackaged) {
  app.setAsDefaultProtocolClient("tandem");
} else if (process.env.TANDEM_DEV_PROTOCOL === "1" && process.argv[1]) {
  app.setAsDefaultProtocolClient("tandem", process.execPath, [path.resolve(process.argv[1])]);
}

function handleLink(link: string): void {
  const repo = parseJoinLink(link);
  if (!repo) return; // ignore anything that is not a valid join link
  pendingJoin = repo;
  if (origin) loadApp(repo);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot(): Promise<void> {
  const logDir = app.getPath("logs");
  if (process.env.TANDEM_DESKTOP_STUB === "1") {
    const stub = await startStub(token);
    origin = `http://127.0.0.1:${stub.port}`;
    backend = new Backend({ cliPath: "", gitExe: gitExe(), logDir, token });
    backend.port = stub.port;
  } else {
    backend = new Backend({ cliPath: cliPath(), gitExe: gitExe(), logDir, token });
    backend.on("ready", () => {
      origin = backend!.origin;
      serverError = null;
      events.connect(origin, token);
      loadApp(pendingJoin ?? undefined);
      pendingJoin = null;
    });
    backend.on("down", (reason: string) => {
      serverError = reason;
      origin = "";
      showLoading();
    });
  }

  createTray();
  registerIpc();
  const link = findDeepLink(process.argv);
  if (link) handleLink(link);
  if (!startHidden) createWindow();

  if (process.env.TANDEM_DESKTOP_STUB === "1") {
    events.connect(origin, token);
    loadApp();
  } else {
    backend.start();
  }

  startUpdater((m) => backend?.note(m), shutdown);
  void setupShim();
}

async function setupShim(): Promise<void> {
  if (process.platform !== "win32") return;
  if (!app.isPackaged && process.env.TANDEM_DEV_SHIM !== "1") return;
  try {
    const result = await ensureShim({
      exe: process.execPath,
      cliPath: cliPath(),
      gitExe: gitExe(),
      binDir: defaultBinDir(),
      log: (m) => backend?.note(m),
    });
    backend?.note(`shim: PATH ${result}`);
    if (result === "added" && !readState().shimHintShown) {
      writeState({ shimHintShown: true });
      new Notification({
        title: "Tandem",
        body: "已加入 tandem 指令。請重新開啟 Claude Code / Codex，它們才會讀到新的 PATH。",
      }).show();
    }
  } catch (e) {
    backend?.note(`shim failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow(): BrowserWindow {
  const saved = readState().bounds;
  let bounds = { width: 1100, height: 750 } as { x?: number; y?: number; width: number; height: number };
  if (saved) {
    bounds = { width: saved.width, height: saved.height };
    const visible = typeof saved.x === "number" && typeof saved.y === "number" &&
      screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return saved.x! < a.x + a.width - 50 && saved.x! + saved.width > a.x + 50 &&
          saved.y! < a.y + a.height - 50 && saved.y! >= a.y - 10;
      });
    if (visible) bounds = { ...bounds, x: saved.x, y: saved.y };
  }
  const w = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: "Tandem",
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [`--tandem-version=${app.getVersion()}`],
    },
  });
  win = w;
  if (saved?.maximized) w.maximize();
  w.once("ready-to-show", () => w.show());

  let timer: NodeJS.Timeout | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (w.isDestroyed()) return;
      writeState({ bounds: { ...w.getNormalBounds(), maximized: w.isMaximized() } });
    }, 400);
  };
  w.on("resize", persist);
  w.on("move", persist);

  w.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    w.hide();
    if (!readState().trayHintShown) {
      writeState({ trayHintShown: true });
      // A real toast (not a tray balloon, which Windows often hides) so people know where it went.
      if (Notification.isSupported()) {
        const note = new Notification({
          title: "Tandem 還在背景執行",
          body: "會繼續幫你同步。要打開時，點右下角工作列的 T 圖示，或從開始選單、桌面捷徑打開 Tandem。",
        });
        note.on("click", () => showWindow());
        note.show();
      }
    }
  });
  w.on("closed", () => {
    win = null;
  });

  // External links: https only, via the OS browser; never navigate away from our server.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttps(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  const guard = (e: Electron.Event, url: string) => {
    if (url.startsWith("data:text/html")) return;
    if (origin && new URL(url).origin === origin) return;
    e.preventDefault();
    if (isHttps(url)) void shell.openExternal(url);
  };
  w.webContents.on("will-navigate", guard);
  w.webContents.on("will-redirect", guard);

  if (origin) loadApp();
  else showLoading();
  return w;
}

function showWindow(): void {
  if (!win || win.isDestroyed()) createWindow();
  const w = win!;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

function showLoading(): void {
  if (!win || win.isDestroyed()) return;
  const msg = serverError ?? "Tandem 正在啟動…";
  const html = `<!doctype html><meta charset="utf-8"><title>Tandem</title><body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#444"><div>${msg.replace(/[<&>]/g, "")}</div>`;
  void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

/** Load the web app. The token in the URL is swapped for a cookie by the server. */
function loadApp(join?: string): void {
  if (!win || win.isDestroyed() || !origin) return;
  const q = join ? `join=${join}&t=${token}` : `t=${token}`;
  void win.loadURL(`${origin}/?${q}`);
  if (join) showWindow();
}

// ---------------------------------------------------------------------------
// Tray, badge, notifications
// ---------------------------------------------------------------------------
function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(iconPath()));
  tray.on("click", showWindow);
  updateAttention(0);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "開啟 Tandem", click: showWindow },
      // TODO: wire to the server (POST /api/sync/pause) once it exists; no-op for now.
      { label: "暫停同步", type: "checkbox", checked: false, click: () => {} },
      { type: "separator" },
      {
        label: "結束",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function badgeImage(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - c) ** 2 + (y - c) ** 2 <= 7.5 ** 2) {
        const o = (y * size + x) * 4;
        buf[o] = 0x30; // B
        buf[o + 1] = 0x30; // G
        buf[o + 2] = 0xe0; // R
        buf[o + 3] = 0xff;
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function updateAttention(n: number): void {
  attention = n;
  tray?.setToolTip(n > 0 ? `Tandem：${n} 件事在等你` : "Tandem");
  if (win && !win.isDestroyed()) {
    win.setOverlayIcon(n > 0 ? badgeImage() : null, n > 0 ? `${n} 件事在等你` : "");
  }
}

function toast(n: AppNotification): void {
  if (notified.has(n.id) || !Notification.isSupported()) return;
  notified.add(n.id);
  const note = new Notification({ title: n.title, body: n.body });
  note.on("click", () => {
    showWindow();
    if (isHttps(n.url)) void shell.openExternal(n.url);
  });
  note.show();
}

function onAppEvent(e: AppEvent): void {
  if (process.env.TANDEM_DESKTOP_STUB === "1") backend?.note(`event ${e.type}: attention=${e.type === "session" ? e.data.projects[0]?.attention : ""}`);
  if (e.type === "notify") toast(e.data);
  else if (e.type === "session") {
    updateAttention(e.data.projects.reduce((sum, p) => sum + (p.attention || 0), 0));
  }
}

// ---------------------------------------------------------------------------
// IPC (renderer is only trusted when it is our own server's page)
// ---------------------------------------------------------------------------
function fromOurPage(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  try {
    return !!origin && new URL(e.senderFrame?.url ?? "").origin === origin;
  } catch {
    return false;
  }
}

function openAtLogin(): boolean {
  return app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin;
}

function registerIpc(): void {
  ipcMain.handle("tandem:setOpenAtLogin", (e, v: unknown) => {
    if (!fromOurPage(e) || typeof v !== "boolean") return openAtLogin();
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: v, args: ["--hidden"] });
    return app.isPackaged ? openAtLogin() : v;
  });
  ipcMain.handle("tandem:getOpenAtLogin", (e) => (fromOurPage(e) ? openAtLogin() : false));
  ipcMain.on("tandem:setBadge", (e, n: unknown) => {
    if (!fromOurPage(e) || typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 9999) return;
    updateAttention(n);
  });
}

// ---------------------------------------------------------------------------
// Quit
// ---------------------------------------------------------------------------
let shuttingDown = false;
async function shutdown(): Promise<void> {
  quitting = true;
  events.stop();
  await backend?.stop();
}

app.on("before-quit", (e) => {
  quitting = true;
  if (shuttingDown) return;
  shuttingDown = true;
  e.preventDefault();
  void shutdown().finally(() => app.quit());
});

// Closing the window only hides it; the tray keeps the app alive.
app.on("window-all-closed", () => {});
