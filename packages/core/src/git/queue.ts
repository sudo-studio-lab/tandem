import path from "node:path";

/** Strictly serial promise queue. A failing task does not block later ones. */
export class GitQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

const queues = new Map<string, GitQueue>();

/** One queue per repo root. */
export function getQueue(repoRoot: string): GitQueue {
  const key = path.resolve(repoRoot);
  let q = queues.get(key);
  if (!q) {
    q = new GitQueue();
    queues.set(key, q);
  }
  return q;
}
