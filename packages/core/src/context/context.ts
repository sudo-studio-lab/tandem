/**
 * Shared context (`tandem/context/` in the team data repo), read and written through the
 * DataStore so writes go through the same outbox and sync as decisions.
 *
 * Locking: every read returns `version` (the git blob sha). A write may pass `expectVersion`;
 * if the file changed since, the write is refused with TandemError("conflict"). The check runs
 * before queueing and again at push time (FileChange.expectVersion), so two people saving at the
 * same moment cannot silently overwrite each other.
 */
import {
  CONTEXT_DIR,
  CONTEXT_MAX_BYTES,
  CONTEXT_NOTES,
  TandemError,
  base64Bytes,
  contextConflictMessage,
  contextKind,
  sortContextFiles,
  validateContextPath,
  type ContextConflict,
  type ContextFile,
  type ContextFileInfo,
  type ContextWriteInput,
  type ContextWriteResult,
} from "@tandem/contracts";
import { gitBlobSha, type DataStore, type PathChange } from "../data/index.ts";
import { describeSecrets, findSecrets } from "./secrets.ts";

const full = (rel: string): string => `${CONTEXT_DIR}/${rel}`;
const relOf = (p: string): string => p.slice(CONTEXT_DIR.length + 1);

/** Commit message for a context change; the login is how the list knows who changed what. */
export function contextCommitMessage(rel: string, me: string, why?: string): string {
  // The reason goes on its own prefixed line so it can never pass for another attribution line.
  return `tandem: context ${rel} (@${me})${why ? `\n\n原因：${why}` : ""}`;
}

/** Login recorded for `rel` in a (possibly batched) commit message. */
export function contextAuthor(message: string, rel: string): string | undefined {
  for (const line of message.split("\n")) {
    const m = /^(?:- )?tandem: context (\S+) \(@([A-Za-z0-9-]{1,39})\)$/.exec(line.trim());
    if (m && m[1] === rel) return m[2];
  }
  return undefined;
}

/** Who this computer writes records as: its GitHub login and the git email its commits carry. */
export interface ContextSelf {
  login: string;
  email: string;
}

/** Login from a GitHub noreply address (`123+login@…` or `login@users.noreply.github.com`). */
export function noreplyLogin(email: string): string | undefined {
  return /^(?:\d+\+)?([A-Za-z0-9-]{1,39})@users\.noreply\.github\.com$/i.exec(email.trim())?.[1];
}

/**
 * Who changed a context file, as a GitHub login. The login line in the commit message wins; then a
 * noreply address; then "me" when the commit carries this computer's git email. A plain git author
 * name is never shown, because it is not a login and would read as a different person.
 */
function who(h: PathChange | undefined, rel: string, self?: ContextSelf): { by?: string; at?: string } {
  if (!h) return {};
  const mine = !!self && !!h.authorEmail && h.authorEmail.toLowerCase() === self.email.toLowerCase();
  const by = contextAuthor(h.message, rel) ?? noreplyLogin(h.authorEmail) ?? (mine ? self.login : undefined);
  return { ...(by ? { by } : {}), ...(h.at ? { at: h.at } : {}) };
}

/** Last known change per context path (relative), including deleted ones. */
export async function contextHistory(store: DataStore, self?: ContextSelf): Promise<Map<string, { by?: string; at?: string }>> {
  const hist = await store.history(CONTEXT_DIR);
  const out = new Map<string, { by?: string; at?: string }>();
  for (const [p, h] of hist) out.set(relOf(p), who(h, relOf(p), self));
  return out;
}

/** Every allowed file in the shared context; notes.md first. */
export async function listContext(store: DataStore, self?: ContextSelf): Promise<ContextFileInfo[]> {
  const [entries, hist] = await Promise.all([store.tree(CONTEXT_DIR), store.history(CONTEXT_DIR)]);
  const files: ContextFileInfo[] = [];
  for (const e of entries) {
    const rel = relOf(e.path);
    const k = contextKind(rel);
    if (!k) continue;
    files.push({
      path: rel,
      kind: k.kind,
      mime: k.mime,
      size: e.size,
      version: e.version,
      ...who(hist.get(e.path), rel, self),
      ...(e.pending ? { pending: true } : {}),
    });
  }
  return sortContextFiles(files);
}

/** One file with its content and version, or null when it does not exist. */
export async function readContext(store: DataStore, path: string): Promise<ContextFile | null> {
  const rel = validateContextPath(path);
  const k = contextKind(rel)!;
  const bytes = await store.readBytes(full(rel));
  if (bytes === null) return null;
  const hist = await store.history(CONTEXT_DIR);
  const h = hist.get(full(rel));
  return {
    path: rel,
    kind: k.kind,
    mime: k.mime,
    size: bytes.length,
    version: gitBlobSha(bytes),
    ...who(h, rel),
    ...(h?.pending ? { pending: true } : {}),
    content: k.kind === "text" ? bytes.toString("utf8") : bytes.toString("base64"),
    encoding: k.kind === "text" ? "utf8" : "base64",
  };
}

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1")),
  "image/webp": (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};

function decodeBase64(s: string): Buffer {
  const clean = s.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) throw new TandemError("validation", "base64 內容格式不對");
  return Buffer.from(clean, "base64");
}

const tooBig = () => new TandemError("validation", `檔案太大，每個檔案最多 ${CONTEXT_MAX_BYTES / 1024 / 1024} MB`);

/** Validate and turn the input into bytes. Text must be UTF-8 without secrets; images must match their extension. */
function prepare(rel: string, input: ContextWriteInput): { bytes: Buffer; text: string | null } {
  const k = contextKind(rel)!;
  if (typeof input.content !== "string") throw new TandemError("validation", "要給檔案內容");
  const enc = input.encoding ?? "utf8";
  if (enc !== "utf8" && enc !== "base64") throw new TandemError("validation", "encoding 只能是 utf8 或 base64");
  if (enc === "base64" && base64Bytes(input.content) > CONTEXT_MAX_BYTES) throw tooBig();
  if (enc === "utf8" && input.content.length > CONTEXT_MAX_BYTES) throw tooBig();
  if (k.kind === "image") {
    if (enc !== "base64") throw new TandemError("validation", "圖片要用 base64 傳");
    const bytes = decodeBase64(input.content);
    if (bytes.length > CONTEXT_MAX_BYTES) throw tooBig();
    if (!MAGIC[k.mime]?.(bytes)) throw new TandemError("validation", `內容不是 ${k.mime.replace("image/", "").toUpperCase()} 圖片`);
    return { bytes, text: null };
  }
  const bytes = enc === "base64" ? decodeBase64(input.content) : Buffer.from(input.content, "utf8");
  if (bytes.length > CONTEXT_MAX_BYTES) throw tooBig();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TandemError("validation", "這不是 UTF-8 文字檔");
  }
  if (text.includes("\0")) throw new TandemError("validation", "這不是文字檔");
  return { bytes, text };
}

/** Throw TandemError("validation") when the text looks like it holds credentials. */
export function assertNoSecrets(text: string, where?: string): void {
  const msg = describeSecrets(findSecrets(text), where);
  if (msg) throw new TandemError("validation", msg);
}

function conflict(rel: string, version: string | null, by: string | undefined): TandemError {
  const details: ContextConflict = { path: rel, version, ...(by ? { by } : {}) };
  return new TandemError("conflict", contextConflictMessage(by), details);
}

async function lastBy(store: DataStore, rel: string): Promise<string | undefined> {
  return who((await store.history(CONTEXT_DIR)).get(full(rel)), rel).by;
}

async function commit(
  store: DataStore,
  rel: string,
  change: { content: string | null; encoding?: "base64"; expectVersion?: string | null },
  message: string,
  version: string | null,
): Promise<ContextWriteResult> {
  const w = await store.write([{ path: full(rel), ...change }], message);
  if (w.result === "conflict") {
    const now = await store.readBytes(full(rel));
    throw conflict(rel, now ? gitBlobSha(now) : null, await lastBy(store, rel));
  }
  return { path: rel, version, result: w.result === "pushed" ? "pushed" : "saved", ...(w.message ? { message: w.message } : {}) };
}

function oneLine(why: string | undefined): string {
  return (why ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Create or replace a context file. `me` is recorded in the commit message.
 * Throws TandemError("validation") for bad paths/content/secrets and ("conflict") when
 * `expectVersion` no longer matches.
 */
export async function writeContext(store: DataStore, input: ContextWriteInput, opts: { me: string }): Promise<ContextWriteResult> {
  const rel = validateContextPath(input.path);
  const { bytes, text } = prepare(rel, input);
  const why = oneLine(input.why);
  if (text !== null) assertNoSecrets(text);
  if (why) assertNoSecrets(why, "原因");

  const cur = await store.readBytes(full(rel));
  const curVersion = cur ? gitBlobSha(cur) : null;
  if (input.expectVersion !== undefined && input.expectVersion !== curVersion) {
    throw conflict(rel, curVersion, await lastBy(store, rel));
  }
  const version = gitBlobSha(bytes);
  if (version === curVersion) return { path: rel, version, result: "pushed" };
  const change =
    text === null
      ? { content: bytes.toString("base64"), encoding: "base64" as const }
      : { content: text };
  return commit(
    store,
    rel,
    { ...change, ...(input.expectVersion !== undefined ? { expectVersion: input.expectVersion } : {}) },
    contextCommitMessage(rel, opts.me, why),
    version,
  );
}

/** Delete a context file (optionally only if it still has `expectVersion`). */
export async function deleteContext(
  store: DataStore,
  path: string,
  opts: { me: string; expectVersion?: string; why?: string },
): Promise<ContextWriteResult> {
  const rel = validateContextPath(path);
  const cur = await store.readBytes(full(rel));
  if (!cur) throw new TandemError("validation", `找不到 ${rel}`);
  const curVersion = gitBlobSha(cur);
  if (opts.expectVersion !== undefined && opts.expectVersion !== curVersion) {
    throw conflict(rel, curVersion, await lastBy(store, rel));
  }
  const why = oneLine(opts.why) || "刪除";
  return commit(
    store,
    rel,
    { content: null, ...(opts.expectVersion !== undefined ? { expectVersion: opts.expectVersion } : {}) },
    contextCommitMessage(rel, opts.me, why),
    null,
  );
}

const NOTES_LINES = 15;
const NOTES_LINE_MAX = 200;

/** First lines of notes.md for the brief, or undefined when there is none. */
export async function notesHead(store: DataStore, lines = NOTES_LINES): Promise<string | undefined> {
  const text = await store.read(full(CONTEXT_NOTES));
  if (!text || !text.trim()) return undefined;
  const all = text.replace(/\r\n/g, "\n").split("\n");
  const head = all.slice(0, lines).map((l) => (l.length > NOTES_LINE_MAX ? `${l.slice(0, NOTES_LINE_MAX - 1)}…` : l));
  while (head.length && !head[head.length - 1]!.trim()) head.pop();
  const more = all.slice(lines).some((l) => l.trim());
  return `${head.join("\n")}${more ? "\n…" : ""}`;
}
