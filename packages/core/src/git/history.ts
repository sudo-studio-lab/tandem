import { openGitDataStore } from "../data/git-store.ts";
import { runGit } from "./run.ts";

export interface ChangedCommit {
  sha: string;
  author: string;
  email: string;
  time: string;
  subject: string;
}
export interface ChangedFile {
  path: string;
  status: "A" | "M" | "D" | "R";
  commit: string;
}

const RS = "\x1e";
const US = "\x1f";

function mapStatus(s: string): ChangedFile["status"] {
  switch (s[0]) {
    case "A":
    case "C":
      return "A";
    case "D":
      return "D";
    case "R":
      return "R";
    default:
      return "M";
  }
}

/**
 * Commits (and the files they touched under `paths`) since `sinceCommit`.
 * Looks at `ref` (default: refs/remotes/origin/<default branch>, falling back to HEAD when
 * that ref does not exist) rather than the user's checkout.
 * Falls back to the last 7 days when sinceCommit is null or no longer an ancestor of the ref.
 * Empty `paths` means the whole repo.
 */
export async function changesSince(
  repoRoot: string,
  sinceCommit: string | null,
  paths: string[],
  ref?: string,
): Promise<{ commits: ChangedCommit[]; files: ChangedFile[] }> {
  let target = ref;
  if (!target) {
    const remoteRef = `refs/remotes/origin/${await openGitDataStore(repoRoot).defaultBranch()}`;
    const ok = await runGit(["rev-parse", "--verify", "-q", `${remoteRef}^{commit}`], { cwd: repoRoot, allowFail: true });
    target = ok.code === 0 ? remoteRef : "HEAD";
  }
  let range: string[] = ["--since=7 days ago", target];
  if (sinceCommit) {
    const ok = await runGit(["merge-base", "--is-ancestor", sinceCommit, target], { cwd: repoRoot, allowFail: true });
    if (ok.code === 0) range = [`${sinceCommit}..${target}`];
  }
  const args = [
    "log",
    `--format=${RS}%H${US}%an${US}%ae${US}%aI${US}%s`,
    "--name-status",
    "-M",
    ...range,
    "--",
    ...paths,
  ];
  const res = await runGit(args, { cwd: repoRoot, allowFail: true });
  const commits: ChangedCommit[] = [];
  const files: ChangedFile[] = [];
  if (res.code !== 0) return { commits, files };
  for (const rec of res.stdout.split(RS)) {
    if (!rec.trim()) continue;
    const lines = rec.split("\n");
    const [sha, author, email, time, ...subj] = (lines[0] ?? "").split(US);
    if (!sha) continue;
    commits.push({ sha, author: author ?? "", email: email ?? "", time: time ?? "", subject: subj.join(US) });
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const status = parts[0] ?? "M";
      const file = parts[parts.length - 1];
      if (file) files.push({ path: file, status: mapStatus(status), commit: sha });
    }
  }
  return { commits, files };
}
