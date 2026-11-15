/** Shared per-command context: repo, GitHub client, current user, local state. */
import {
  createGitHubClient,
  findRepoRoot,
  getGitHubToken,
  getRemoteRepo,
  gitAuthEnv,
  openGitDataStore,
  readLocalState,
  runGit,
  writeLocalState,
  type DataStore,
  type EtagCache,
  type LocalState,
} from "@tandem/core";

export type GitHubClient = ReturnType<typeof createGitHubClient>;

/** Local state plus CLI-only bookkeeping for agent sessions. */
export type CliState = LocalState & {
  sessions?: Record<string, { startedAt: string; head: string | null; nudged?: boolean; reinject?: boolean; tree?: string }>;
};

export interface Context {
  repoRoot: string;
  remote: { owner: string; name: string; url: string };
  gh: GitHubClient;
  me: string;
  state: CliState;
  saveState(): Promise<void>;
  /** GitHub token; only ever passed to child processes through `gitEnv`. */
  token: string;
  /** Env for git network commands: token as an extra header, never in config or argv. */
  gitEnv: Record<string, string>;
  /** Records live on the remote default branch. */
  store: DataStore;
}

/** Commit author for records: the repo's git identity, else the GitHub noreply address. */
async function authorFor(repoRoot: string, login: string): Promise<{ name: string; email: string }> {
  const get = async (k: string) => (await runGit(["config", "--get", k], { cwd: repoRoot, allowFail: true })).stdout.trim();
  const [name, email] = await Promise.all([get("user.name"), get("user.email")]);
  return { name: name || login, email: email || `${login}@users.noreply.github.com` };
}

function stateEtagCache(state: CliState): EtagCache {
  return {
    get(key: string) {
      const hit = state.etags?.[key];
      return hit ? { etag: hit.etag, body: hit.body } : undefined;
    },
    set(key: string, etag: string, body: unknown) {
      state.etags ??= {};
      state.etags[key] = { etag, body, savedAt: new Date().toISOString() };
    },
  };
}

export async function openContext(cwd: string = process.cwd(), opts: { token?: string } = {}): Promise<Context> {
  const repoRoot = await findRepoRoot(cwd);
  const remote = await getRemoteRepo(repoRoot);
  const state = (await readLocalState(repoRoot)) as CliState;
  const token = opts.token ?? (await getGitHubToken()).token;
  const gh = createGitHubClient({ token, owner: remote.owner, repo: remote.name, cache: stateEtagCache(state) });
  let me = state.login;
  if (!me) {
    me = await gh.viewerLogin();
    state.login = me;
    await writeLocalState(repoRoot, state);
  }
  const gitEnv = gitAuthEnv(token);
  const store = openGitDataStore(repoRoot, { gitEnv, author: await authorFor(repoRoot, me) });
  return {
    repoRoot,
    remote,
    gh,
    me,
    state,
    saveState: () => writeLocalState(repoRoot, state),
    token,
    gitEnv,
    store,
  };
}

/** Run a promise but give up after `ms`, resolving to `fallback`. Used to keep hooks fast. */
export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
