import {
  LABELS,
  TandemError,
  type DiscussionSummary,
  type Invitation,
  type OwnerChoice,
  type PullRequestSummary,
  type RepoChoice,
  type RoomRef,
  type TaskSummary,
} from "@tandem/contracts";
import { createMemoryEtagCache, type EtagCache } from "./cache.ts";
import { discussionKindFromLabels, parseRoomHost, parseRoomNotes, parseWaitingLine, roomBody, withWaitingLine } from "./parse.ts";

const API = "https://api.github.com";
const MAX_RETRIES = 2;
/** Longest rate-limit wait we are willing to sit through. */
const MAX_WAIT_MS = 60_000;
const WRITE_GAP_MS = 1000;

export interface GitHubClientOptions {
  token: string;
  owner: string;
  repo: string;
  cache?: EtagCache;
  fetch?: typeof fetch;
  /** Test hooks. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RoomData extends RoomRef {
  id: string;
  notes: string;
  comments: { id: string; by: string; body: string; url: string; at: string }[];
}

export interface DiscussionsInfo {
  enabled: boolean;
  repositoryId: string;
  qaCategoryId?: string;
  categories: { id: string; name: string; slug: string; isAnswerable: boolean }[];
}

export interface CreateDiscussionInput {
  kind: "question" | "disagreement";
  title: string;
  body: string;
  waitingOn: string[];
}

export interface CreateIssueInput {
  title: string;
  body?: string;
  assignees?: string[];
  labels?: string[];
}

export interface CreateRepoInput {
  owner: string;
  name: string;
  /** True when owner is an organization. */
  isOrg: boolean;
}

export interface CreatedRepo {
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
}

export interface RepoInfo {
  defaultBranch: string;
  private: boolean;
  permissions: { admin: boolean; push: boolean; pull: boolean };
}

/** Plain, un-aggregated GitHub activity of one repo (input of activity/computeActivity). */
export interface ActivityRaw {
  /** https://github.com/<owner>/<repo> */
  repoUrl: string;
  /** One entry per (branch, commit); the same oid appears once per branch that contains it. */
  commits: {
    oid: string;
    branch: string;
    headline: string;
    committedDate: string;
    url: string;
    /** GitHub login of the author; null when the commit email is not linked to a GitHub account. */
    login: string | null;
  }[];
  pullRequests: {
    number: number;
    title: string;
    url: string;
    author: string | null;
    createdAt: string;
    mergedAt: string | null;
    mergedBy: string | null;
  }[];
  /** Discussion comments and issue/PR comments. `title` is the discussion title, or "#<n>" for issue/PR comments. */
  comments: { login: string | null; title: string; url: string; createdAt: string }[];
}

export type GitHubClient = ReturnType<typeof createGitHubClient>;

interface ReqOpts {
  method?: string;
  path: string;
  body?: unknown;
  /** Use the ETag cache (GET only). */
  etag?: boolean;
  /** What the call is for, to word permission errors. */
  what?: string;
}

interface Res {
  status: number;
  body: any;
}

const LABEL_SPECS: Record<string, { color: string; description: string }> = {
  [LABELS.question]: { color: "1d76db", description: "Tandem：等人回答的問題" },
  [LABELS.disagreement]: { color: "d93f0b", description: "Tandem：需要討論的分歧" },
  [LABELS.task]: { color: "0e8a16", description: "Tandem：任務" },
};

export function createGitHubClient(opts: GitHubClientOptions) {
  const { token, owner, repo } = opts;
  const cache = opts.cache ?? createMemoryEtagCache();
  const doFetch = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const repoPath = `/repos/${owner}/${repo}`;
  let lastWriteAt = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();
  let viewer: string | undefined;

  /** Run tasks one at a time. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  function waitMs(h: Headers): number | undefined {
    const ra = h.get("retry-after");
    if (ra && /^\d+$/.test(ra.trim())) return Number(ra) * 1000;
    if (h.get("x-ratelimit-remaining") === "0") {
      const reset = Number(h.get("x-ratelimit-reset"));
      if (reset) return Math.max(0, reset * 1000 - now()) + 500;
    }
    return undefined;
  }

  function isRateLimited(status: number, h: Headers, msg: string): boolean {
    if (status === 429) return true;
    if (status !== 403) return false;
    return h.has("retry-after") || h.get("x-ratelimit-remaining") === "0" || /rate limit|abuse|secondary/i.test(msg);
  }

  function mapError(status: number, msg: string, what: string): TandemError {
    const detail = msg ? `（GitHub 回應：${msg}）` : "";
    if (status === 401) return new TandemError("auth", `GitHub 登入已失效或權限不足。請重新執行 gh auth login${detail}`, { status });
    if (status === 403)
      return new TandemError(
        "needs_human",
        `沒有權限${what}。需要 repo 的管理員到 GitHub 網頁調整權限或組織設定，或請有權限的人代為操作${detail}`,
        { status },
      );
    if (status === 404)
      return new TandemError("github", `找不到 ${owner}/${repo} 或沒有權限看到它（私人 repo 需要先被邀請）${detail}`, { status });
    if (status === 429) return new TandemError("github", `GitHub 請求太頻繁，請稍後再試${detail}`, { status });
    if (status === 422) return new TandemError("github", `GitHub 拒絕了這個請求（內容無效）${detail}`, { status });
    return new TandemError("github", `GitHub 回傳錯誤 ${status}${detail}`, { status });
  }

  async function send(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
    isWrite: boolean,
    what: string,
  ): Promise<{ res: Response; json: any }> {
    for (let attempt = 0; ; attempt++) {
      if (isWrite) {
        const wait = lastWriteAt + WRITE_GAP_MS - now();
        if (wait > 0) await sleep(wait);
      }
      let res: Response;
      try {
        res = await doFetch(url, init);
      } catch {
        throw new TandemError("offline", "連不上 GitHub。請檢查網路連線後再試");
      }
      if (isWrite) lastWriteAt = now();
      let text = "";
      try {
        text = await res.text();
      } catch {
        /* empty body */
      }
      let json: any = undefined;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
      }
      if (res.status === 304 || (res.status >= 200 && res.status < 300)) return { res, json };
      const msg = typeof json?.message === "string" ? json.message : "";
      if (isRateLimited(res.status, res.headers, msg)) {
        const w = waitMs(res.headers) ?? 60_000;
        if (attempt < MAX_RETRIES && w <= MAX_WAIT_MS) {
          await sleep(w);
          continue;
        }
        throw new TandemError("github", `GitHub 的使用額度暫時用完了，請約 ${Math.ceil(w / 1000)} 秒後再試`, { status: res.status });
      }
      throw mapError(res.status, msg, what);
    }
  }

  function rest(o: ReqOpts): Promise<Res> {
    return enqueue(async () => {
      const method = o.method ?? "GET";
      const url = o.path.startsWith("http") ? o.path : `${API}${o.path}`;
      const headers: Record<string, string> = {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "tandem",
      };
      let cached: { etag: string; body: unknown } | undefined;
      if (o.etag && method === "GET") {
        cached = cache.get(url);
        if (cached) headers["if-none-match"] = cached.etag;
      }
      let body: string | undefined;
      if (o.body !== undefined) {
        body = JSON.stringify(o.body);
        headers["content-type"] = "application/json";
      }
      const { res, json } = await send(url, { method, headers, body }, method !== "GET", o.what ?? "執行這個操作");
      if (res.status === 304) {
        if (!cached) throw new TandemError("github", "GitHub 回傳 304 但本機沒有快取");
        return { status: 200, body: cached.body };
      }
      if (o.etag && method === "GET" && res.status === 200) {
        const et = res.headers.get("etag");
        if (et) cache.set(url, et, json);
      }
      return { status: res.status, body: json };
    });
  }

  function graphql<T = any>(query: string, variables: Record<string, unknown> = {}, what = "執行這個操作"): Promise<T> {
    return enqueue(async () => {
      const headers = {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "tandem",
      };
      const isMutation = /^\s*mutation\b/.test(query);
      const { json } = await send(
        `${API}/graphql`,
        { method: "POST", headers, body: JSON.stringify({ query, variables }) },
        isMutation,
        what,
      );
      if (json?.errors?.length) {
        const first = json.errors[0];
        const msg = String(first?.message ?? "");
        if (first?.type === "FORBIDDEN" || /must have (admin|write|push)|not accessible|permission/i.test(msg)) {
          throw new TandemError(
            "needs_human",
            `沒有權限${what}。需要 repo 的管理員到 GitHub 網頁處理${msg ? `（GitHub 回應：${msg}）` : ""}`,
            { errors: json.errors },
          );
        }
        if (first?.type === "NOT_FOUND") throw new TandemError("github", `找不到 ${owner}/${repo} 或沒有權限看到它`, { errors: json.errors });
        throw new TandemError("github", `GitHub 查詢失敗：${msg}`, { errors: json.errors });
      }
      return json?.data as T;
    });
  }

  // ---- helpers ----
  async function listAll(path: string, etag = true): Promise<any[]> {
    const out: any[] = [];
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; page <= 10; page++) {
      const r = await rest({ path: `${path}${sep}per_page=100&page=${page}`, etag, what: "讀取資料" });
      const arr = Array.isArray(r.body) ? r.body : [];
      out.push(...arr);
      if (arr.length < 100) break;
    }
    return out;
  }

  async function discussionNodeId(number: number): Promise<string> {
    const d = await graphql<any>(
      `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){discussion(number:$number){id}}}`,
      { owner, repo, number },
      "讀取討論",
    );
    const id = d?.repository?.discussion?.id;
    if (!id) throw new TandemError("github", `找不到討論 #${number}`);
    return id;
  }

  // ---- public methods ----
  async function viewerLogin(): Promise<string> {
    if (viewer) return viewer;
    const r = await rest({ path: "/user", what: "讀取登入資訊" });
    const login = r.body?.login;
    if (typeof login !== "string") throw new TandemError("github", "讀不到目前登入的 GitHub 帳號");
    viewer = login;
    return login;
  }

  async function inviteCollaborator(login: string): Promise<"invited" | "already"> {
    const r = await rest({
      method: "PUT",
      path: `${repoPath}/collaborators/${encodeURIComponent(login)}`,
      body: { permission: "push" },
      what: `邀請 ${login}（需要管理權限；組織 repo 可能禁止邀請外部協作者；每個 repo 每 24 小時最多 50 個邀請）`,
    }).catch((e) => {
      if (e instanceof TandemError && e.code === "github" && (e.details as any)?.status === 422) {
        throw new TandemError(
          "github",
          `無法邀請 ${login}：帳號不存在，或已超過每 24 小時 50 個邀請的上限，或組織不允許外部協作者`,
          e.details,
        );
      }
      throw e;
    });
    return r.status === 204 ? "already" : "invited";
  }

  async function acceptInvitationFor(): Promise<"accepted" | "none"> {
    const list = await listAll("/user/repository_invitations", false);
    const want = `${owner}/${repo}`.toLowerCase();
    const inv = list.find((i) => String(i?.repository?.full_name ?? "").toLowerCase() === want);
    if (!inv) return "none";
    await acceptInvitation(inv.id);
    return "accepted";
  }

  async function acceptInvitation(id: number): Promise<void> {
    await rest({ method: "PATCH", path: `/user/repository_invitations/${id}`, what: "接受邀請" });
  }

  async function listInvitations(): Promise<Invitation[]> {
    const list = await listAll("/user/repository_invitations", false);
    return list.map((i) => {
      const full = String(i?.repository?.full_name ?? "");
      return {
        id: i.id,
        repo: {
          owner: i?.repository?.owner?.login ?? full.split("/")[0] ?? "",
          name: i?.repository?.name ?? full.split("/")[1] ?? "",
          fullName: full,
          private: !!i?.repository?.private,
        },
        inviter: i?.inviter?.login ?? "ghost",
        createdAt: i?.created_at ?? "",
      };
    });
  }

  /** People with access to this repo (needs push access to list). Pending invitees are not included. */
  async function listCollaborators(): Promise<string[]> {
    const r = await rest({ path: `${repoPath}/collaborators?affiliation=all&per_page=100`, etag: true, what: "讀取成員" });
    return Array.isArray(r.body) ? r.body.map((u: any) => String(u.login)).filter(Boolean) : [];
  }

  async function getRepo(): Promise<RepoInfo> {
    const r = await rest({ path: repoPath, what: "讀取專案資訊" });
    const b = r.body ?? {};
    return {
      defaultBranch: b.default_branch ?? "main",
      private: !!b.private,
      permissions: { admin: !!b.permissions?.admin, push: !!b.permissions?.push, pull: b.permissions?.pull !== false },
    };
  }

  async function listProjectMembers(): Promise<{login:string;role:string}[]> {
    const users=await listAll(`${repoPath}/collaborators?affiliation=all`,false);
    return users.map(u=>({login:String(u.login),role:String(u.role_name??(u.permissions?.admin?"admin":"write"))}));
  }
  async function removeCollaborator(login:string):Promise<void> {
    if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login))throw new TandemError("validation","GitHub 帳號格式不對");
    await rest({method:"DELETE",path:`${repoPath}/collaborators/${encodeURIComponent(login)}`,what:"移除直接授予的專案存取權"});
  }
  async function hasCollaborator(login:string):Promise<boolean>{
    try{await rest({path:`${repoPath}/collaborators/${encodeURIComponent(login)}`,what:"確認成員存取權"});return true;}
    catch(e){if(e instanceof TandemError&&(e.details as any)?.status===404)return false;throw e;}
  }
  async function assignIssue(number:number,assignees:string[]):Promise<void>{
    await rest({method:"PATCH",path:`${repoPath}/issues/${number}`,body:{assignees},what:"交接任務指派"});
  }

  /** Repos the user can push to, newest push first. Up to 3 pages of 100. */
  async function listMyRepos(o: { q?: string } = {}): Promise<RepoChoice[]> {
    const out: RepoChoice[] = [];
    const q = o.q?.trim().toLowerCase();
    for (let page = 1; page <= 3; page++) {
      const r = await rest({
        path: `/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100&page=${page}`,
        etag: true,
        what: "讀取你的專案清單",
      });
      const arr: any[] = Array.isArray(r.body) ? r.body : [];
      for (const x of arr) {
        if (!x?.permissions?.push) continue;
        const fullName = String(x.full_name ?? "");
        if (q && !fullName.toLowerCase().includes(q)) continue;
        const c: RepoChoice = {
          owner: x.owner?.login ?? fullName.split("/")[0] ?? "",
          name: x.name,
          fullName,
          private: !!x.private,
        };
        if (x.pushed_at) c.pushedAt = x.pushed_at;
        out.push(c);
      }
      if (arr.length < 100) break;
    }
    return out;
  }

  /** The viewer plus every organization they belong to. Whether they may create repos there is only known on creation. */
  async function listOwners(): Promise<OwnerChoice[]> {
    const me = await viewerLogin();
    const r = await rest({ path: "/user/orgs?per_page=100", etag: true, what: "讀取你的組織" });
    const orgs: OwnerChoice[] = (Array.isArray(r.body) ? r.body : [])
      .filter((o: any) => typeof o?.login === "string")
      .map((o: any) => ({ login: o.login as string, kind: "org" as const }));
    return [{ login: me, kind: "user" }, ...orgs];
  }

  /** Create a private repo with an initial commit, so its default branch exists. */
  async function createRepo(input: CreateRepoInput): Promise<CreatedRepo> {
    const r = await rest({
      method: "POST",
      path: input.isOrg ? `/orgs/${encodeURIComponent(input.owner)}/repos` : "/user/repos",
      body: { name: input.name, private: true, auto_init: true },
      what: input.isOrg ? `在組織 ${input.owner} 建立專案（需要組織允許你建立 repo）` : "建立專案",
    });
    const b = r.body ?? {};
    return {
      owner: b.owner?.login ?? input.owner,
      name: b.name ?? input.name,
      fullName: b.full_name ?? `${input.owner}/${input.name}`,
      cloneUrl: b.clone_url ?? `https://github.com/${input.owner}/${input.name}.git`,
      defaultBranch: b.default_branch ?? "main",
    };
  }

  /** Recent commits (all branches), PRs, discussion comments and issue comments since `since` (ISO). */
  async function getActivityRaw(o: { since: string }): Promise<ActivityRaw> {
    const q = `query($owner:String!,$repo:String!,$since:GitTimestamp!){repository(owner:$owner,name:$repo){
      refs(refPrefix:"refs/heads/",first:30,orderBy:{field:TAG_COMMIT_DATE,direction:DESC}){nodes{name target{... on Commit{history(since:$since,first:30){nodes{oid messageHeadline committedDate url author{user{login}}}}}}}}
      pullRequests(first:30,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url createdAt mergedAt author{login} mergedBy{login}}}
      discussions(first:20,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{title url comments(last:10){nodes{author{login} createdAt url}}}}
    }}`;
    const d = await graphql<any>(q, { owner, repo, since: o.since }, "讀取成員動態");
    const r = d?.repository;
    const raw: ActivityRaw = { repoUrl: `https://github.com/${owner}/${repo}`, commits: [], pullRequests: [], comments: [] };
    for (const ref of r?.refs?.nodes ?? []) {
      for (const c of ref?.target?.history?.nodes ?? []) {
        raw.commits.push({
          oid: c.oid,
          branch: ref.name,
          headline: c.messageHeadline ?? "",
          committedDate: c.committedDate,
          url: c.url,
          login: c.author?.user?.login ?? null,
        });
      }
    }
    for (const p of r?.pullRequests?.nodes ?? []) {
      raw.pullRequests.push({
        number: p.number,
        title: p.title,
        url: p.url,
        author: p.author?.login ?? null,
        createdAt: p.createdAt,
        mergedAt: p.mergedAt ?? null,
        mergedBy: p.mergedBy?.login ?? null,
      });
    }
    for (const disc of r?.discussions?.nodes ?? []) {
      for (const c of disc?.comments?.nodes ?? []) {
        raw.comments.push({ login: c.author?.login ?? null, title: disc.title, url: c.url, createdAt: c.createdAt });
      }
    }
    const ic = await rest({
      path: `${repoPath}/issues/comments?since=${encodeURIComponent(o.since)}&sort=created&direction=desc&per_page=50`,
      what: "讀取留言",
    });
    for (const c of Array.isArray(ic.body) ? ic.body : []) {
      const n = /\/(\d+)$/.exec(String(c.issue_url ?? ""))?.[1];
      raw.comments.push({
        login: c.user?.login ?? null,
        title: n ? `#${n}` : "issue",
        url: c.html_url,
        createdAt: c.created_at,
      });
    }
    return raw;
  }

  async function getDiscussionsInfo(): Promise<DiscussionsInfo> {
    const d = await graphql<any>(
      `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){id hasDiscussionsEnabled discussionCategories(first:25){nodes{id name slug isAnswerable}}}}`,
      { owner, repo },
      "讀取 Discussions 設定",
    );
    const r = d?.repository;
    if (!r) throw new TandemError("github", `找不到 ${owner}/${repo}`);
    const categories: DiscussionsInfo["categories"] = (r.discussionCategories?.nodes ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      isAnswerable: !!c.isAnswerable,
    }));
    const qa = categories.find((c) => c.slug === "q-a") ?? categories.find((c) => c.isAnswerable);
    const info: DiscussionsInfo = { enabled: !!r.hasDiscussionsEnabled, repositoryId: r.id, categories };
    if (qa) info.qaCategoryId = qa.id;
    return info;
  }

  async function enableDiscussions(): Promise<void> {
    await rest({
      method: "PATCH",
      path: repoPath,
      body: { has_discussions: true },
      what: "開啟 Discussions（需要 repo 的管理權限，或到 Settings > General > Features 勾選 Discussions）",
    });
  }

  async function ensureLabels(): Promise<string[]> {
    const existing = await listAll(`${repoPath}/labels`, false);
    const names = new Set(existing.map((l) => String(l.name).toLowerCase()));
    const created: string[] = [];
    for (const name of Object.values(LABELS)) {
      if (names.has(name.toLowerCase())) continue;
      const spec = LABEL_SPECS[name];
      await rest({
        method: "POST",
        path: `${repoPath}/labels`,
        body: { name, color: spec?.color, description: spec?.description },
        what: "建立標籤",
      });
      created.push(name);
    }
    return created;
  }

  async function labelNodeId(name: string): Promise<string | undefined> {
    const d = await graphql<any>(
      `query($owner:String!,$repo:String!,$name:String!){repository(owner:$owner,name:$repo){label(name:$name){id}}}`,
      { owner, repo, name },
      "讀取標籤",
    );
    return d?.repository?.label?.id ?? undefined;
  }

  async function createDiscussion(input: CreateDiscussionInput): Promise<{ id: string; number: number; url: string }> {
    const info = await getDiscussionsInfo();
    if (!info.enabled || !info.qaCategoryId) {
      throw new TandemError(
        "needs_human",
        info.enabled
          ? "這個 repo 的 Discussions 沒有可用的 Q&A 分類。請到 GitHub 網頁的 Discussions 設定確認分類"
          : "這個 repo 還沒開啟 Discussions。請 repo 管理員到 Settings > General > Features 開啟，或同意讓 Tandem 開啟",
        { reason: "discussions_disabled" },
      );
    }
    const label = LABELS[input.kind];
    let labelId = await labelNodeId(label);
    if (!labelId) {
      await ensureLabels();
      labelId = await labelNodeId(label);
    }
    const d = await graphql<any>(
      `mutation($repositoryId:ID!,$categoryId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repositoryId,categoryId:$categoryId,title:$title,body:$body}){discussion{id number url}}}`,
      {
        repositoryId: info.repositoryId,
        categoryId: info.qaCategoryId,
        title: input.title,
        body: withWaitingLine(input.body, input.waitingOn),
      },
      "建立討論",
    );
    const disc = d?.createDiscussion?.discussion;
    if (!disc) throw new TandemError("github", "建立討論失敗：GitHub 沒有回傳討論");
    if (labelId) {
      await graphql(
        `mutation($labelableId:ID!,$labelIds:[ID!]!){addLabelsToLabelable(input:{labelableId:$labelableId,labelIds:$labelIds}){clientMutationId}}`,
        { labelableId: disc.id, labelIds: [labelId] },
        "加上標籤",
      );
    }
    return { id: disc.id, number: disc.number, url: disc.url };
  }

  async function commentOnDiscussion(number: number, body: string): Promise<void> {
    const id = await discussionNodeId(number);
    await graphql(
      `mutation($discussionId:ID!,$body:String!){addDiscussionComment(input:{discussionId:$discussionId,body:$body}){comment{id}}}`,
      { discussionId: id, body },
      "留言",
    );
  }

  // ---- rooms: a discussion whose body starts with the room marker ----
  async function createRoom(title: string, host: string, notes = ""): Promise<RoomRef> {
    const info = await getDiscussionsInfo();
    if (!info.enabled) {
      throw new TandemError("needs_human", "這個 repo 還沒開啟 Discussions。請 repo 管理員到 Settings > General > Features 開啟", {
        reason: "discussions_disabled",
      });
    }
    const cat =
      info.categories.find((c) => c.slug === "general") ?? info.categories.find((c) => !c.isAnswerable) ?? info.categories[0];
    if (!cat) throw new TandemError("needs_human", "這個 repo 的 Discussions 沒有任何分類");
    const d = await graphql<any>(
      `mutation($repositoryId:ID!,$categoryId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repositoryId,categoryId:$categoryId,title:$title,body:$body}){discussion{number url updatedAt}}}`,
      { repositoryId: info.repositoryId, categoryId: cat.id, title, body: roomBody(host, notes) },
      "建立房間",
    );
    const disc = d?.createDiscussion?.discussion;
    if (!disc) throw new TandemError("github", "建立房間失敗：GitHub 沒有回傳討論");
    return { number: disc.number, url: disc.url, title, host, closed: false, updatedAt: disc.updatedAt };
  }

  /** Open rooms, plus rooms closed in the last 7 days. */
  async function listRooms(): Promise<RoomRef[]> {
    const d = await graphql<any>(
      `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){discussions(first:50,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url body closed updatedAt}}}}`,
      { owner, repo },
      "讀取房間",
    );
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const out: RoomRef[] = [];
    for (const n of d?.repository?.discussions?.nodes ?? []) {
      const host = parseRoomHost(n.body ?? "");
      if (!host || (n.closed && n.updatedAt < since)) continue;
      out.push({ number: n.number, url: n.url, title: n.title, host, closed: !!n.closed, updatedAt: n.updatedAt });
    }
    return out;
  }

  async function getRoom(number: number): Promise<RoomData> {
    const q = `query($owner:String!,$repo:String!,$number:Int!,$after:String){repository(owner:$owner,name:$repo){discussion(number:$number){id number title url body closed updatedAt comments(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id body url createdAt author{login}}}}}}`;
    let after: string | null = null;
    let room: RoomData | null = null;
    for (let page = 0; page < 10; page++) {
      const d: any = await graphql(q, { owner, repo, number, after }, "讀取房間");
      const n = d?.repository?.discussion;
      const host = n ? parseRoomHost(n.body ?? "") : null;
      if (!n || !host) throw new TandemError("usage", `#${number} 不是 Tandem 的房間`);
      room ??= { id: n.id, number: n.number, url: n.url, title: n.title, host, closed: !!n.closed, updatedAt: n.updatedAt, notes: parseRoomNotes(n.body ?? ""), comments: [] };
      for (const c of n.comments?.nodes ?? []) {
        room.comments.push({ id: c.id, by: c.author?.login ?? "ghost", body: c.body ?? "", url: c.url, at: c.createdAt });
      }
      if (!n.comments?.pageInfo?.hasNextPage) break;
      after = n.comments.pageInfo.endCursor;
    }
    return room!;
  }

  async function commentOnRoom(number: number, body: string): Promise<{ id: string; url: string; at: string }> {
    const id = await discussionNodeId(number);
    const d = await graphql<any>(
      `mutation($discussionId:ID!,$body:String!){addDiscussionComment(input:{discussionId:$discussionId,body:$body}){comment{id url createdAt}}}`,
      { discussionId: id, body },
      "在房間留言",
    );
    const c = d?.addDiscussionComment?.comment;
    if (!c) throw new TandemError("github", "留言失敗：GitHub 沒有回傳留言");
    return { id: c.id, url: c.url, at: c.createdAt };
  }

  async function setRoomNotes(number: number, host: string, notes: string): Promise<void> {
    const id = await discussionNodeId(number);
    await graphql(
      `mutation($discussionId:ID!,$body:String!){updateDiscussion(input:{discussionId:$discussionId,body:$body}){discussion{id}}}`,
      { discussionId: id, body: roomBody(host, notes) },
      "更新房間筆記",
    );
  }

  async function closeDiscussion(number: number, reason: "RESOLVED" | "OUTDATED" | "DUPLICATE"): Promise<void> {
    const id = await discussionNodeId(number);
    await graphql(
      `mutation($discussionId:ID!,$reason:DiscussionCloseReason!){closeDiscussion(input:{discussionId:$discussionId,reason:$reason}){discussion{id}}}`,
      { discussionId: id, reason },
      "關閉討論",
    );
  }

  async function listDiscussions(o: { includeClosedSince?: string } = {}): Promise<DiscussionSummary[]> {
    const q = `query($owner:String!,$repo:String!,$after:String){repository(owner:$owner,name:$repo){discussions(first:50,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{id number title url body closed createdAt updatedAt author{login} answer{id} labels(first:10){nodes{name}} comments(first:50){nodes{author{login}}}}}}}`;
    const out: DiscussionSummary[] = [];
    let after: string | null = null;
    for (let page = 0; page < 4; page++) {
      const d: any = await graphql(q, { owner, repo, after }, "讀取討論");
      const conn = d?.repository?.discussions;
      if (!conn) break;
      for (const n of conn.nodes ?? []) {
        if (n.closed && !(o.includeClosedSince && n.updatedAt >= o.includeClosedSince)) continue;
        if (parseRoomHost(n.body ?? "")) continue; // rooms have their own tab
        const author = n.author?.login ?? "ghost";
        const labels: string[] = (n.labels?.nodes ?? []).map((l: any) => l.name);
        const commenters: string[] = [];
        for (const c of n.comments?.nodes ?? []) {
          const l = c?.author?.login;
          if (l && l !== author && !commenters.includes(l)) commenters.push(l);
        }
        out.push({
          id: n.id,
          number: n.number,
          title: n.title,
          url: n.url,
          kind: discussionKindFromLabels(labels),
          author,
          waitingOn: parseWaitingLine(n.body),
          commenters,
          answered: !!n.answer,
          closed: !!n.closed,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        });
      }
      if (!conn.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
    return out;
  }

  async function createIssue(input: CreateIssueInput): Promise<{ number: number; url: string }> {
    const body: Record<string, unknown> = { title: input.title };
    if (input.body !== undefined) body.body = input.body;
    if (input.assignees?.length) body.assignees = input.assignees;
    if (input.labels?.length) body.labels = input.labels;
    const r = await rest({ method: "POST", path: `${repoPath}/issues`, body, what: "建立 issue" });
    return { number: r.body.number, url: r.body.html_url };
  }

  /** Open blockers per open issue, via GraphQL Issue.blockedBy. Optional: failures other than auth/offline give an empty map. */
  async function fetchBlockedBy(): Promise<Map<number, number[]>> {
    const map = new Map<number, number[]>();
    try {
      const d: any = await graphql(
        `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){issues(states:OPEN,first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number blockedBy(first:20){nodes{number state}}}}}}`,
        { owner, repo },
        "讀取任務依賴",
      );
      for (const n of d?.repository?.issues?.nodes ?? []) {
        const open = (n.blockedBy?.nodes ?? []).filter((b: any) => b.state === "OPEN").map((b: any) => b.number as number);
        if (open.length) map.set(n.number, open);
      }
    } catch (e) {
      if (e instanceof TandemError && (e.code === "auth" || e.code === "offline")) throw e;
    }
    return map;
  }

  async function listIssues(o: { since?: string; state?: "open" | "all" } = {}): Promise<TaskSummary[]> {
    const params = new URLSearchParams({ state: o.state ?? "open", sort: "updated", direction: "desc" });
    if (o.since) params.set("since", o.since);
    const raw = (await listAll(`${repoPath}/issues?${params}`)).filter((i) => !i.pull_request);
    const blocked = raw.some((i) => i.state === "open") ? await fetchBlockedBy() : new Map<number, number[]>();
    return raw.map((i) => {
      const t: TaskSummary = {
        number: i.number,
        title: i.title,
        url: i.html_url,
        state: i.state === "closed" ? "closed" : "open",
        assignees: (i.assignees ?? []).map((a: any) => a.login),
        labels: (i.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
        author: i.user?.login ?? "ghost",
        blockedBy: i.state === "open" ? (blocked.get(i.number) ?? []) : [],
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      };
      if (i.closed_at) t.closedAt = i.closed_at;
      return t;
    });
  }

  async function listPullRequests(o: { state?: "open" | "all" } = {}): Promise<PullRequestSummary[]> {
    const raw = await listAll(`${repoPath}/pulls?state=${o.state ?? "open"}&sort=updated&direction=desc`);
    return raw.map((p) => {
      const s: PullRequestSummary = {
        number: p.number,
        title: p.title,
        url: p.html_url,
        author: p.user?.login ?? "ghost",
        state: p.merged_at ? "merged" : p.state === "closed" ? "closed" : "open",
        draft: !!p.draft,
        requestedReviewers: (p.requested_reviewers ?? []).map((r: any) => r.login),
          closes: closingIssueNumbers(p.body ?? "", `${owner}/${repo}`),
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      };
      if (p.merged_at) s.mergedAt = p.merged_at;
      return s;
    });
  }

  return {
    viewerLogin,
    inviteCollaborator,
    acceptInvitationFor,
    acceptInvitation,
    listInvitations,
    getRepo,
    listProjectMembers,
    removeCollaborator,
    hasCollaborator,
    assignIssue,
    listCollaborators,
    listMyRepos,
    listOwners,
    createRepo,
    getActivityRaw,
    getDiscussionsInfo,
    enableDiscussions,
    ensureLabels,
    createDiscussion,
    commentOnDiscussion,
    closeDiscussion,
    createRoom,
    listRooms,
    getRoom,
    commentOnRoom,
    setRoomNotes,
    listDiscussions,
    createIssue,
    listIssues,
    listPullRequests,
  };
}

/**
 * Create a discussion; when Discussions are unavailable, fall back to an issue
 * with the same label (data-model.md: 暫時 fallback).
 */
export async function createDiscussionOrIssue(
  client: Pick<GitHubClient, "createDiscussion" | "createIssue">,
  input: CreateDiscussionInput,
): Promise<{ kind: "discussion" | "issue"; number: number; url: string }> {
  try {
    const d = await client.createDiscussion(input);
    return { kind: "discussion", number: d.number, url: d.url };
  } catch (e) {
    if (e instanceof TandemError && e.code === "needs_human" && (e.details as any)?.reason === "discussions_disabled") {
      const i = await client.createIssue({
        title: input.title,
        body: withWaitingLine(input.body, input.waitingOn),
        labels: [LABELS[input.kind]],
      });
      return { kind: "issue", number: i.number, url: i.url };
    }
    throw e;
  }
}
import { closingIssueNumbers } from "./task-links.ts";
