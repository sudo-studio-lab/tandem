/**
 * Shared context: a folder in the team data repo (`tandem/context/`) that every teammate and
 * every teammate's agent can read and write. `notes.md` holds background, architecture and
 * requirements; other files are specs, diagrams, mockups and longer reports.
 * Pure helpers only (the web mock imports this file directly).
 */
import { TandemError } from "./errors.ts";

/** Repo-relative folder of the shared context. */
export const CONTEXT_DIR = "tandem/context";
/** The pinned background file. */
export const CONTEXT_NOTES = "notes.md";
/** Per-file size limit in bytes. */
export const CONTEXT_MAX_BYTES = 2 * 1024 * 1024;
/** At most this many path segments, file name included (`a/b/c.md`). */
export const CONTEXT_MAX_DEPTH = 3;

export const CONTEXT_TEXT_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".svg": "image/svg+xml",
  ".mmd": "text/plain",
};
export const CONTEXT_IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export type ContextKind = "text" | "image";

/** One file in the shared context. `path` is relative to `tandem/context/`. */
export interface ContextFileInfo {
  path: string;
  /** "text" files are stored as UTF-8; "image" files are binary (sent as base64). SVG counts as text. */
  kind: ContextKind;
  mime: string;
  size: number;
  /** Git blob sha of the current content. Pass it back as `expectVersion` to write safely. */
  version: string;
  /** GitHub login (or git author name) of whoever changed it last, when known. */
  by?: string;
  /** ISO time of the last change, when known. */
  at?: string;
  /** Saved on this computer, not on the remote yet. */
  pending?: boolean;
}

export interface ContextFile extends ContextFileInfo {
  /** UTF-8 text for text files, base64 for images. */
  content: string;
  encoding: "utf8" | "base64";
}

export interface ContextWriteInput {
  path: string;
  content: string;
  /** Default "utf8". Images must be "base64". */
  encoding?: "utf8" | "base64";
  /**
   * Version from the last read. A string: the file must still have that version. null: the file
   * must not exist yet. Omitted: overwrite whatever is there.
   */
  expectVersion?: string | null;
  /** One line: why this change (kept in the commit message). */
  why?: string;
}

export interface ContextWriteResult {
  path: string;
  /** New version, or null after a delete. */
  version: string | null;
  /** "pushed": on the remote. "saved": kept on this computer and synced later. */
  result: "pushed" | "saved";
  message?: string;
}

/** Details on a TandemError("conflict") from a context write. */
export interface ContextConflict {
  path: string;
  /** Current version (null: the file was deleted). */
  version: string | null;
  by?: string;
}

const SEGMENT_RE = /^[\p{L}\p{N}_][\p{L}\p{N}._-]*$/u;

export function contextExt(p: string): string {
  const name = p.slice(p.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function contextKind(p: string): { kind: ContextKind; mime: string } | null {
  const ext = contextExt(p);
  if (CONTEXT_TEXT_TYPES[ext]) return { kind: "text", mime: CONTEXT_TEXT_TYPES[ext] };
  if (CONTEXT_IMAGE_TYPES[ext]) return { kind: "image", mime: CONTEXT_IMAGE_TYPES[ext] };
  return null;
}

/**
 * Check a path relative to `tandem/context/` and return it in canonical form (forward slashes,
 * no leading `./`). Throws TandemError("validation") with a short Chinese message.
 */
export function validateContextPath(input: string): string {
  const bad = (why: string): never => {
    throw new TandemError("validation", `檔名不行：${why}`);
  };
  if (typeof input !== "string") bad("要給檔名");
  let p = input.trim().replace(/\\/g, "/");
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith(`${CONTEXT_DIR}/`)) p = p.slice(CONTEXT_DIR.length + 1);
  if (!p) bad("要給檔名");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) bad("只能用相對路徑");
  if (p.length > 200) bad("路徑太長");
  const parts = p.split("/");
  if (parts.some((s) => s === "." || s === "..")) bad("不能有 .. 或 .");
  if (parts.length > CONTEXT_MAX_DEPTH) bad(`最多 ${CONTEXT_MAX_DEPTH} 層（例如 specs/api/v1.md）`);
  for (const s of parts) {
    if (!s) bad("路徑裡有空的資料夾名稱");
    if (s.length > 100) bad("名稱太長");
    if (!SEGMENT_RE.test(s)) bad(`「${s}」只能用文字、數字、. _ -，不能有空白，也不能用 . 開頭`);
  }
  if (!contextKind(p)) {
    bad(`只收 ${[...Object.keys(CONTEXT_TEXT_TYPES), ...Object.keys(CONTEXT_IMAGE_TYPES)].join(" ")}`);
  }
  return p;
}

/** Bytes encoded by a base64 string (without decoding it). */
export function base64Bytes(b64: string): number {
  const s = b64.replace(/\s/g, "");
  return Math.floor((s.length * 3) / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
}

/** notes.md first, then by path. */
export function sortContextFiles<T extends { path: string }>(files: T[]): T[] {
  return [...files].sort((a, b) =>
    a.path === CONTEXT_NOTES ? -1 : b.path === CONTEXT_NOTES ? 1 : a.path.localeCompare(b.path),
  );
}

/** The conflict message shown to people; `by` is the login that changed the file. */
export function contextConflictMessage(by?: string): string {
  return `這個檔案剛被 ${by ? `@${by} ` : "別人"}改過，請重新載入再改`;
}
