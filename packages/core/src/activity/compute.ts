import type { ActivityItem } from "@tandem/contracts";
import type { ActivityRaw } from "../github/client.ts";

export interface ComputeActivityOptions {
  members: string[];
  now?: Date;
  /** Look-back window in days (default 7). */
  days?: number;
  /** Max items per member (default 10). */
  perMember?: number;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Turn raw GitHub activity into per-member, newest-first activity items.
 * Result has a key for every member (empty array when nothing happened); logins are matched
 * case-insensitively and the key keeps the casing given in `members`.
 */
export function computeActivity(raw: ActivityRaw, opts: ComputeActivityOptions): Record<string, ActivityItem[]> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 7;
  const perMember = opts.perMember ?? 10;
  const cutoff = now.getTime() - days * 86_400_000;
  const inWindow = (iso: string | null | undefined): iso is string => !!iso && Date.parse(iso) >= cutoff && Date.parse(iso) <= now.getTime() + 86_400_000;

  const byLower = new Map<string, string>();
  const result: Record<string, ActivityItem[]> = {};
  for (const m of opts.members) {
    byLower.set(m.toLowerCase(), m);
    result[m] = [];
  }
  const memberOf = (login: string | null | undefined): string | undefined => (login ? byLower.get(login.toLowerCase()) : undefined);

  // Commits: dedupe by oid across branches (first occurrence wins; the client lists the most recently
  // updated branch first). Commits without a GitHub user login (author email not linked to an account)
  // are dropped: we cannot tell whose they are, and guessing from the email would misattribute.
  const seen = new Set<string>();
  const groups = new Map<string, { member: string; branch: string; commits: ActivityRaw["commits"] }>();
  for (const c of raw.commits) {
    if (seen.has(c.oid)) continue;
    seen.add(c.oid);
    const member = memberOf(c.login);
    if (!member || !inWindow(c.committedDate)) continue;
    const key = `${member}\u0000${c.branch}\u0000${localDay(new Date(c.committedDate))}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { member, branch: c.branch, commits: [] }));
    g.commits.push(c);
  }
  for (const g of groups.values()) {
    const latest = g.commits.reduce((a, b) => (Date.parse(b.committedDate) > Date.parse(a.committedDate) ? b : a));
    const n = g.commits.length;
    result[g.member]!.push({
      kind: "commit",
      login: g.member,
      title: `推了 ${n} 個 commit 到 ${g.branch}：${latest.headline}`,
      url: latest.url || `${raw.repoUrl}/commits/${encodeURIComponent(g.branch)}`,
      time: latest.committedDate,
      branch: g.branch,
      count: n,
    });
  }

  for (const p of raw.pullRequests) {
    const opener = memberOf(p.author);
    if (opener && inWindow(p.createdAt)) {
      result[opener]!.push({ kind: "pr_opened", login: opener, title: p.title, url: p.url, time: p.createdAt });
    }
    const merger = memberOf(p.mergedBy);
    if (merger && inWindow(p.mergedAt)) {
      result[merger]!.push({ kind: "pr_merged", login: merger, title: p.title, url: p.url, time: p.mergedAt! });
    }
  }

  for (const c of raw.comments) {
    const member = memberOf(c.login);
    if (!member || !inWindow(c.createdAt)) continue;
    result[member]!.push({ kind: "comment", login: member, title: `在「${c.title}」留言`, url: c.url, time: c.createdAt });
  }

  for (const m of Object.keys(result)) {
    result[m] = result[m]!.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, perMember);
  }
  return result;
}
