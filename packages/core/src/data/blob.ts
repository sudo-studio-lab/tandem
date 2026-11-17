import { createHash } from "node:crypto";
import type { FileChange } from "./types.ts";

/** Git's blob id for these bytes (same as `git hash-object`). */
export function gitBlobSha(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Bytes of a non-delete change. */
export function changeBytes(c: FileChange): Buffer {
  return c.encoding === "base64" ? Buffer.from(c.content ?? "", "base64") : Buffer.from(c.content ?? "", "utf8");
}
