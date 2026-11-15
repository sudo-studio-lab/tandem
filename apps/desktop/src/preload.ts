import { contextBridge, ipcRenderer } from "electron";

const versionArg = process.argv.find((a) => a.startsWith("--tandem-version="));

contextBridge.exposeInMainWorld("tandemDesktop", {
  setOpenAtLogin: (v: boolean): Promise<boolean> => ipcRenderer.invoke("tandem:setOpenAtLogin", !!v),
  getOpenAtLogin: (): Promise<boolean> => ipcRenderer.invoke("tandem:getOpenAtLogin"),
  setBadge: (n: number): void => ipcRenderer.send("tandem:setBadge", n),
  version: versionArg ? versionArg.slice("--tandem-version=".length) : "",
});
