import fs from "node:fs/promises";
import path from "node:path";
import { PATHS } from "@tandem/contracts";
import type { DataStore, FileChange, WriteResult } from "./types.ts";
import { assertRelPath } from "./net.ts";

/** Plain folder store: for tests and repos without a remote. */
export function openFsDataStore(root: string): DataStore {
  const abs = (p: string): string => {
    assertRelPath(p);
    return path.join(root, ...p.split("/"));
  };
  const exists = async (p: string): Promise<boolean> =>
    fs.access(abs(p)).then(
      () => true,
      () => false,
    );
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
      try {
        return await fs.readFile(abs(p), "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async write(changes: FileChange[]): Promise<WriteResult> {
      const clashes: string[] = [];
      for (const c of changes) if (c.createOnly && c.content !== null && (await exists(c.path))) clashes.push(c.path);
      if (clashes.length)
        return { result: "conflict", conflicts: clashes, message: `已經有同名檔案：${clashes.join(", ")}` };
      for (const c of changes) {
        const file = abs(c.path);
        if (c.content === null) {
          await fs.rm(file, { force: true });
        } else {
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, c.content, "utf8");
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
