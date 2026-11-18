import fs from "node:fs/promises";
import path from "node:path";
import { PATHS } from "@tandem/contracts";
import type { DataStore, FileChange, PathChange, TreeEntry, WriteResult } from "./types.ts";
import { changeBytes, gitBlobSha } from "./blob.ts";
import { assertRelPath } from "./net.ts";

/** Plain folder store: for tests and repos without a remote. */
export function openFsDataStore(root: string): DataStore {
  const abs = (p: string): string => {
    assertRelPath(p);
    return path.join(root, ...p.split("/"));
  };
  const readBytes = async (p: string): Promise<Buffer | null> => {
    try {
      return await fs.readFile(abs(p));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  };
  const walk = async (prefix: string): Promise<{ rel: string; file: string }[]> => {
    const pre = prefix.replace(/\/+$/, "");
    const out: { rel: string; file: string }[] = [];
    const visit = async (rel: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(abs(rel), { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return;
        throw e;
      }
      for (const e of entries) {
        const child = `${rel}/${e.name}`;
        if (e.isDirectory()) await visit(child);
        else if (e.isFile()) out.push({ rel: child, file: abs(child) });
      }
    };
    await visit(pre);
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  };
  return {
    repoRoot: root,
    kind: "fs",
    async defaultBranch() {
      return "main";
    },
    async list(dir) {
      try {
        const names = await fs.readdir(path.join(root, PATHS[dir]));
        return names.filter((n) => n.endsWith(".md")).sort();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
      }
    },
    async read(p) {
      const b = await readBytes(p);
      return b === null ? null : b.toString("utf8");
    },
    readBytes,
    async tree(prefix): Promise<TreeEntry[]> {
      const out: TreeEntry[] = [];
      for (const { rel, file } of await walk(prefix)) {
        const bytes = await fs.readFile(file);
        out.push({ path: rel, version: gitBlobSha(bytes), size: bytes.length });
      }
      return out;
    },
    async history(prefix): Promise<Map<string, PathChange>> {
      const out = new Map<string, PathChange>();
      for (const { rel, file } of await walk(prefix)) {
        const st = await fs.stat(file);
        out.set(rel, { message: "", authorName: "", authorEmail: "", at: st.mtime.toISOString() });
      }
      return out;
    },
    async write(changes: FileChange[]): Promise<WriteResult> {
      const clashes: string[] = [];
      let changed = false;
      for (const c of changes) {
        const cur = await readBytes(c.path);
        if (c.createOnly && c.content !== null && cur !== null) clashes.push(c.path);
        if (c.expectVersion !== undefined && (cur === null ? null : gitBlobSha(cur)) !== c.expectVersion) {
          clashes.push(c.path);
          changed = true;
        }
      }
      if (clashes.length)
        return {
          result: "conflict",
          conflicts: clashes,
          message: changed ? `檔案剛被別人改過：${clashes.join(", ")}` : `已經有同名檔案：${clashes.join(", ")}`,
        };
      for (const c of changes) {
        const file = abs(c.path);
        if (c.content === null) {
          await fs.rm(file, { force: true });
        } else {
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, changeBytes(c));
        }
      }
      return { result: "pushed" };
    },
    async flush() {
      return { result: "pushed" };
    },
    async pending() {
      return 0;
    },
    async snapshot() {
      return null;
    },
  };
}
