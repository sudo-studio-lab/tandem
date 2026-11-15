import type { AppEvent } from "@tandem/contracts";

type Handler = (e: AppEvent) => void;

/**
 * Minimal SSE client for GET /api/events using fetch (Bearer token), reconnecting with
 * backoff. Understands both `event: <type>` + `data: <payload json>` and a bare
 * `data: {"type":..,"data":..}` AppEvent.
 */
export class EventStream {
  private ctrl: AbortController | null = null;
  private running = false;
  private attempt = 0;
  private base: { origin: string; token: string } | null = null;

  constructor(
    private onEvent: Handler,
    private log: (m: string) => void,
  ) {}

  /** (Re)connect to a (possibly new) server. */
  connect(origin: string, token: string): void {
    this.base = { origin, token };
    this.ctrl?.abort();
    this.attempt = 0;
    if (!this.running) {
      this.running = true;
      void this.loop();
    }
  }

  stop(): void {
    this.running = false;
    this.ctrl?.abort();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const base = this.base!;
      const ctrl = (this.ctrl = new AbortController());
      let watchdog: NodeJS.Timeout | undefined;
      const arm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => ctrl.abort(), 90_000); // server pings; silence = dead
      };
      try {
        const res = await fetch(`${base.origin}/api/events`, {
          headers: { Authorization: `Bearer ${base.token}`, Accept: "text/event-stream" },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        this.attempt = 0;
        arm();
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          arm();
          buf += value.replace(/\r\n/g, "\n");
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            this.dispatch(buf.slice(0, i));
            buf = buf.slice(i + 2);
          }
        }
      } catch (e) {
        if (!ctrl.signal.aborted) this.log(`SSE error: ${(e as Error).message}`);
      } finally {
        clearTimeout(watchdog);
      }
      if (!this.running) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt++);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private dispatch(block: string): void {
    let event = "";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    if (event && event !== "message") {
      this.onEvent({ type: event, data: parsed } as AppEvent);
    } else if (parsed && typeof parsed === "object" && "type" in parsed && "data" in parsed) {
      this.onEvent(parsed as AppEvent);
    }
  }
}
