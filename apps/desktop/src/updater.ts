import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { readState, writeState } from "./state.ts";

const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * Auto-update. The installed electron-updater (6.8.11) has no `autoInstallEvent`,
 * so: download in the background, never install on quit, remember the downloaded version, and on
 * the NEXT launch call quitAndInstall as soon as the cached update is reported downloaded.
 * `shutdown` must stop the server child first (it locks the exe).
 */
export function startUpdater(log: (m: string) => void, shutdown: () => Promise<void>): void {
  if (!app.isPackaged) return;
  const pendingAtLaunch = readState().pendingUpdate;
  let installing = false;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = {
    info: (m) => log(`updater: ${m}`),
    warn: (m) => log(`updater warn: ${m}`),
    error: (m) => log(`updater error: ${m}`),
    debug: () => {},
  };

  autoUpdater.on("update-downloaded", (info) => {
    log(`update downloaded: ${info.version}`);
    if (installing) return;
    if (pendingAtLaunch && pendingAtLaunch === info.version) {
      installing = true;
      void shutdown().then(() => autoUpdater.quitAndInstall(true, true));
    } else {
      writeState({ pendingUpdate: info.version });
    }
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((e: Error) => log(`update check failed: ${e.message}`));
  };
  check();
  setInterval(check, SIX_HOURS).unref();
}
