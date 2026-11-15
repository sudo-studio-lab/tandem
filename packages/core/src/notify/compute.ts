import type { AppNotification, AppSettings, ProjectBoard } from "@tandem/contracts";

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Every thing currently waiting on `me`, keyed by stable id (deduped, so a PR review counts once). */
function collect(board: ProjectBoard, me: string, now: Date): AppNotification[] {
  const out = new Map<string, AppNotification>();
  const add = (n: AppNotification) => {
    if (!out.has(n.id)) out.set(n.id, n);
  };

  for (const w of board.waiting) {
    if (!sameLogin(w.to, me)) continue;
    if (w.kind === "pr_review") {
      add({
        id: `review:${w.url}`,
        kind: "review",
        projectId: board.projectId,
        title: `@${w.from} 在等你審查`,
        body: w.title,
        url: w.url,
        time: w.since,
      });
    } else {
      add({
        id: `waiting:${w.url}`,
        kind: "waiting",
        projectId: board.projectId,
        title: w.kind === "blocked_issue" ? `@${w.from} 的任務在等你` : `@${w.from} 在等你回答`,
        body: w.title,
        url: w.url,
        time: w.since,
      });
    }
  }

  for (const p of board.pullRequests) {
    if (p.state !== "open") continue;
    if (!p.requestedReviewers.some((r) => sameLogin(r, me))) continue;
    add({
      id: `review:${p.url}`,
      kind: "review",
      projectId: board.projectId,
      title: `@${p.author} 請你審查 PR`,
      body: p.title,
      url: p.url,
      time: p.updatedAt || now.toISOString(),
    });
  }

  for (const t of board.tasks) {
    if (t.state !== "open") continue;
    if (!t.assignees.some((a) => sameLogin(a, me)) || sameLogin(t.author, me)) continue;
    add({
      id: `task:${t.url}`,
      kind: "task",
      projectId: board.projectId,
      title: `@${t.author} 指派了任務給你`,
      body: t.title,
      url: t.url,
      time: t.createdAt || now.toISOString(),
    });
  }
  return [...out.values()];
}

/**
 * New things waiting on me that the user has not been notified about yet.
 * Skips ids in `notified` and kinds switched off in settings.
 */
export function computeNotifications(
  board: ProjectBoard,
  opts: { me: string; settings: AppSettings; notified: Set<string>; now?: Date },
): AppNotification[] {
  const now = opts.now ?? new Date();
  return collect(board, opts.me, now).filter((n) => opts.settings.notifications[n.kind] && !opts.notified.has(n.id));
}

/** How many things are waiting on `me` right now (settings and "already notified" do not matter). */
export function attentionCount(board: ProjectBoard, me: string): number {
  return collect(board, me, new Date()).length;
}
