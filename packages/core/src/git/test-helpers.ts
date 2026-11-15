import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGit } from "./run.ts";

export interface Fixture {
  root: string;
  remote: string;
  a: string;
  b: string;
  cleanup(): void;
}

async function configure(dir: string, who: string): Promise<void> {
  await runGit(["config", "user.name", `User ${who}`], { cwd: dir });
  await runGit(["config", "user.email", `${who.toLowerCase()}@example.com`], { cwd: dir });
  await runGit(["config", "core.autocrlf", "false"], { cwd: dir });
}

/** Bare remote plus two clones (user A and B) with an initial commit on `main`. */
export async function makeFixture(): Promise<Fixture> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-git-")));
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(remote);
  await runGit(["init", "--bare", "-b", "main"], { cwd: remote });
  const a = path.join(root, "a");
  const b = path.join(root, "b");
  await runGit(["-c", "core.autocrlf=false", "clone", remote, a], { cwd: root });
  await configure(a, "A");
  fs.writeFileSync(path.join(a, "README.md"), "hello\n");
  await runGit(["checkout", "-B", "main"], { cwd: a });
  await runGit(["add", "."], { cwd: a });
  await runGit(["commit", "-m", "init"], { cwd: a });
  await runGit(["push", "-u", "origin", "main"], { cwd: a });
  await runGit(["-c", "core.autocrlf=false", "clone", remote, b], { cwd: root });
  await configure(b, "B");
  return {
    root,
    remote,
    a,
    b,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

export function write(repo: string, rel: string, content: string): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
