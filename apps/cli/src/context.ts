/** Shared per-command context: repo, GitHub client, current user, local state. */
import {
  createGitHubClient,
  findRepoRoot,
  getGitHubToken,
  getRemoteRepo,
  gitAuthEnv,
  openGitDataStore,
  readLocalState,
  resolveDataLocation,
  runGit,
  writeLocalState,
  type DataRepoOptions,
  type DataStore,
  type EtagCache,
  type LocalState,
} from "@tandem/core";
import {TandemError} from "@tandem/contracts";

export type GitHubClient = ReturnType<typeof createGitHubClient>;

/** Local state plus CLI-only bookkeeping for agent sessions. */
export type CliState = LocalState & {
  sessions?: Record<
    string,
    {
      startedAt: string;
      head: string | null;
      nudged?: boolean;
      reinject?: boolean;
      tree?: string;
      /** Recent decision ids this session already knows (see live-decisions.ts). */
      seenDecisions?: string[];
      decisionsCheckedAt?: string;
      /** Shared-context path -> version this session already knows (see live-context.ts). */
      contextSeen?: Record<string, string>;
      agentMessageSeen?: string[];
    }
  >;
};

export interface Context {
  /** The code repo's working tree: code, PRs, issues, tasks, agent setup. */
  repoRoot: string;
  remote: { owner: string; name: string; url: string };
  gh: GitHubClient;
  /**
   * Local git repo holding team data (decisions, status, team.md). Same as repoRoot unless
   * `.tandem.json` sets `dataRepo`; then a local copy under the app state dir.
   */
  dataRoot: string;
  /** The repo team data lives in, and whether it differs from the code repo. */
  dataRepo: { owner: string; name: string; url: string; separate: boolean };
  /** GitHub client for the data repo; only set when it is a separate repo. */
  dataGh?: GitHubClient;
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

/** A different repo is not necessarily private. GitHub must confirm visibility before sharing. */
export async function requirePrivateDataRepo(ctx:Context):Promise<void>{
  if(!ctx.dataRepo.separate||!ctx.dataGh)throw new TandemError("validation","請先設定獨立的私人團隊資料 repo");
  const info=await ctx.dataGh.getRepo();
  if(!info.private)throw new TandemError("validation","團隊資料 repo 目前是公開的，已停止新的訊息與對話分享。請由管理者確認資料存放位置。");
}

/** Commit author for records: the repo's git identity, else the GitHub noreply address. */
export async function authorFor(repoRoot: string, login: string): Promise<{ name: string; email: string }> {
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
  return assembleContext({ repoRoot, remote, gh, me, state, token });
}

/**
 * The part of openContext after login: find where team data lives (setting up the local data
 * repo copy when `.tandem.json` points elsewhere) and open the store on it. Tests call this
 * directly with `data.remoteUrlFor` pointing at local bare repos.
 */
export async function assembleContext(
  base: Pick<Context, "repoRoot" | "remote" | "gh" | "me" | "state" | "token">,
  opts: { data?: Omit<DataRepoOptions, "gitEnv">; gitEnv?: Record<string, string> } = {},
): Promise<Context> {
  const { repoRoot, remote, me, state, token } = base;
  const gitEnv = opts.gitEnv ?? gitAuthEnv(token);
  const data = await resolveDataLocation(repoRoot, remote, { ...opts.data, gitEnv });
  const store = openGitDataStore(data.root, { gitEnv, author: await authorFor(repoRoot, me) });
  const dataGh = data.separate
    ? createGitHubClient({ token, owner: data.repo.owner, repo: data.repo.name, cache: stateEtagCache(state) })
    : undefined;
  return {
    ...base,
    dataRoot: data.root,
    dataRepo: { ...data.repo, separate: data.separate },
    ...(dataGh ? { dataGh } : {}),
    saveState: () => writeLocalState(repoRoot, state),
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
