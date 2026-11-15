export {};

declare global {
  interface Window {
    /** Present only inside the Tandem desktop app (Electron preload). */
    tandemDesktop?: {
      setOpenAtLogin(v: boolean): Promise<void>;
      getOpenAtLogin(): Promise<boolean>;
      setBadge(n: number): void;
      version: string;
    };
  }
}
