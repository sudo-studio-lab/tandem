export {};

declare global {
  interface Window {
    /** Present only inside the Tandem desktop app (Electron preload). */
    tandemDesktop?: {
      setOpenAtLogin(v: boolean): Promise<void>;
      getOpenAtLogin(): Promise<boolean>;
      setBadge(n: number): void;
      /** Side-panel address (fixed port + long-lived key). Missing in desktop versions before 0.2.7. */
      getSidebarUrl?(): Promise<string>;
      copySidebarUrl?(): Promise<boolean>;
      /** New key: the old address stops working. Resolves to the new address. */
      replaceSidebarUrl?(): Promise<string>;
      version: string;
    };
  }
}
