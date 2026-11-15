import fs from "node:fs";
import path from "node:path";
import { PRODUCT } from "@tandem/contracts";
import { runGit } from "./run.ts";

const BEGIN = `# BEGIN ${PRODUCT.markerName}`;
const END = `# END ${PRODUCT.markerName}`;

async function hookFile(repoRoot: string): Promise<string> {
  // --git-path honours core.hooksPath and worktrees.
  const r = await runGit(["rev-parse", "--git-path", "hooks"], { cwd: repoRoot });
  return path.join(path.resolve(repoRoot, r.stdout.trim()), "pre-commit");
}

function block(command: string): string {
  return [BEGIN, command, "tandem_status=$?", 'if [ "$tandem_status" -ne 0 ]; then exit "$tandem_status"; fi', END].join("\n");
}

function blockRegex(): RegExp {
  return new RegExp(`^${BEGIN}[^\\n]*\\n[\\s\\S]*?^${END}[^\\n]*(?:\\n|$)`, "m");
}

/** Install (or replace) the managed block in pre-commit; foreign content is never removed. */
export async function installPreCommitHook(repoRoot: string, command: string): Promise<void> {
  const file = await hookFile(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const b = block(command);
  let next: string;
  if (!fs.existsSync(file)) {
    next = `#!/bin/sh\n${b}\n`;
  } else {
    const cur = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    if (blockRegex().test(cur)) {
      next = cur.replace(blockRegex(), () => `${b}\n`);
    } else if (cur.startsWith("#!")) {
      const nl = cur.indexOf("\n");
      next = nl === -1 ? `${cur}\n${b}\n` : `${cur.slice(0, nl + 1)}${b}\n${cur.slice(nl + 1)}`;
    } else {
      next = `#!/bin/sh\n${b}\n${cur}`;
    }
  }
  fs.writeFileSync(file, next, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

/** Remove only our block; delete the file if nothing but a shebang remains. */
export async function removePreCommitHook(repoRoot: string): Promise<void> {
  const file = await hookFile(repoRoot);
  if (!fs.existsSync(file)) return;
  const cur = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (!blockRegex().test(cur)) return;
  const next = cur.replace(blockRegex(), "");
  const rest = next.replace(/^#!.*\n?/, "").trim();
  if (!rest) fs.rmSync(file);
  else fs.writeFileSync(file, next, { mode: 0o755 });
}
