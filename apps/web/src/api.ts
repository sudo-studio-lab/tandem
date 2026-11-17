import type { AppEvent } from "@tandem/contracts";

/** Error from the local server (`{ error, code }`) or from the network. */
export class ApiError extends Error {
  code?: string;
  /** Extra data on some errors (e.g. who changed a context file, on a conflict). */
  details?: unknown;
  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

type MockServer = typeof import("./mockServer.ts");
let mockServer: MockServer | null = null;

/** Switch the whole UI to the in-browser fake server (loaded lazily so it stays out of the real bundle). */
export async function enableMock(): Promise<void> {
  mockServer = await import("./mockServer.ts");
}
export const isMock = () => mockServer !== null;

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (mockServer) return structuredClone(await mockServer.handle(method, path, body)) as T;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("連不上 Tandem，請確認程式還開著", "network");
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const b = parsed as { error?: string; code?: string; details?: unknown } | undefined;
    throw new ApiError(b?.error ?? `發生錯誤（${res.status}）`, b?.code, b?.details);
  }
  return parsed as T;
}

export const projectPath = (id: string, tail = "") => `/api/projects/${encodeURIComponent(id)}${tail}`;

const EVENT_TYPES: AppEvent["type"][] = ["session", "board", "sync", "progress", "notify", "chat", "agents", "ping"];

/** Extra listeners for events a component cares about (chat updates); fed by openEvents. */
const listeners = new Set<(e: AppEvent) => void>();
export function onAppEvent(fn: (e: AppEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const fanOut = (e: AppEvent) => listeners.forEach((l) => l(e));

/** Subscribe to server events; reconnects with backoff. Returns an unsubscribe function. */
export function openEvents(onEvent: (e: AppEvent) => void, onConnected: (ok: boolean) => void): () => void {
  if (mockServer) {
    onConnected(true);
    return mockServer.subscribe((e) => {
      onEvent(e);
      fanOut(e);
    });
  }
  if (typeof EventSource === "undefined") return () => {};
  let es: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;
  let closed = false;

  const connect = () => {
    if (closed) return;
    es = new EventSource("/api/events");
    es.onopen = () => {
      delay = 1000;
      onConnected(true);
    };
    es.onerror = () => {
      onConnected(false);
      es?.close();
      if (closed) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    };
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (ev) => {
        const raw = (ev as MessageEvent<string>).data;
        try {
          const e = { type, data: raw ? JSON.parse(raw) : "" } as AppEvent;
          onEvent(e);
          fanOut(e);
        } catch {
          /* ignore malformed event */
        }
      });
    }
  };
  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    es?.close();
  };
}
