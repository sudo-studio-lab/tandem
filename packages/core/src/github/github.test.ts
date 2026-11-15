import { describe, expect, it } from "vitest";
import { LABELS, TandemError } from "@tandem/contracts";
import {
  createDiscussionOrIssue,
  createGitHubClient,
  createMemoryEtagCache,
  discussionKindFromLabels,
  formatWaitingLine,
  getGitHubToken,
  parseWaitingLine,
} from "./index.ts";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: any;
}

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> };

function mockFetch(replies: (Reply | ((c: Call) => Reply))[]) {
  const calls: Call[] = [];
  const f = (async (url: any, init: any) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(url),
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const r = replies.shift();
    if (!r) throw new Error(`unexpected call ${call.method} ${call.url}`);
    const rep = typeof r === "function" ? r(call) : r;
    return new Response(rep.json === undefined ? null : JSON.stringify(rep.json), {
      status: rep.status ?? 200,
      headers: rep.headers,
    });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function make(replies: Parameters<typeof mockFetch>[0], extra: { cache?: any } = {}) {
  const m = mockFetch(replies);
  const sleeps: number[] = [];
  let t = 1_000_000;
  const client = createGitHubClient({
    token: "tok_secret",
    owner: "Acme",
    repo: "Proj",
    fetch: m.f,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
    ...extra,
  });
  return { client, calls: m.calls, sleeps };
}

const gql = (data: unknown) => ({ json: { data } });

describe("pure helpers", () => {
  it("parseWaitingLine", () => {
    expect(parseWaitingLine("等：@a @b\n\nhello")).toEqual(["a", "b"]);
    expect(parseWaitingLine("等: @a-b,@c")).toEqual(["a-b", "c"]);
    expect(parseWaitingLine("hello\n等：@a")).toEqual([]);
    expect(parseWaitingLine("等：@a @a")).toEqual(["a"]);
    expect(parseWaitingLine("")).toEqual([]);
    expect(parseWaitingLine(null)).toEqual([]);
  });
  it("formatWaitingLine", () => {
    expect(formatWaitingLine(["a", "@b"])).toBe("等：@a @b");
    expect(formatWaitingLine([])).toBe("");
  });
  it("discussionKindFromLabels", () => {
    expect(discussionKindFromLabels([LABELS.question])).toBe("question");
    expect(discussionKindFromLabels([LABELS.disagreement, LABELS.question])).toBe("disagreement");
    expect(discussionKindFromLabels(["bug"])).toBe("other");
  });
});

describe("getGitHubToken", () => {
  it("prefers env in order", async () => {
    const r = await getGitHubToken({ GH_TOKEN: "b", GITHUB_TOKEN: "c" }, async () => "gh");
    expect(r).toEqual({ token: "b", source: "env" });
    expect(await getGitHubToken({ TANDEM_TOKEN: "a", GH_TOKEN: "b" }, async () => "gh")).toEqual({ token: "a", source: "env" });
  });
  it("falls back to gh", async () => {
    expect(await getGitHubToken({}, async () => "ghtok")).toEqual({ token: "ghtok", source: "gh" });
  });
  it("throws auth error without leaking anything", async () => {
    await expect(getGitHubToken({}, async () => undefined)).rejects.toMatchObject({
      code: "auth",
      message: "找不到 GitHub 登入。請先執行 gh auth login",
    });
  });
});

describe("rest basics", () => {
  it("viewerLogin sends auth headers and caches", async () => {
    const { client, calls } = make([{ json: { login: "me" } }]);
    expect(await client.viewerLogin()).toBe("me");
    expect(await client.viewerLogin()).toBe("me");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/user");
    expect(calls[0]!.headers.authorization).toBe("Bearer tok_secret");
    expect(calls[0]!.headers["x-github-api-version"]).toBe("2022-11-28");
  });

  it("maps 401 to auth, network failure to offline, without leaking token", async () => {
    const a = make([{ status: 401, json: { message: "Bad credentials" } }]);
    const e = await a.client.viewerLogin().catch((x) => x);
    expect(e).toBeInstanceOf(TandemError);
    expect(e.code).toBe("auth");
    expect(e.message).not.toContain("tok_secret");

    const client = createGitHubClient({
      token: "t",
      owner: "o",
      repo: "r",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as any,
    });
    await expect(client.viewerLogin()).rejects.toMatchObject({ code: "offline" });
  });

  it("403 permission becomes needs_human", async () => {
    const { client } = make([{ status: 403, json: { message: "Must have admin rights to Repository." } }]);
    const e = await client.inviteCollaborator("bob").catch((x) => x);
    expect(e.code).toBe("needs_human");
    expect(e.message).toContain("管理員");
    expect(e.message).toContain("50");
  });

  it("retries 429 using retry-after, at most 2 times", async () => {
    const { client, calls, sleeps } = make([
      { status: 429, headers: { "retry-after": "3" }, json: { message: "slow" } },
      { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(1_000_000 / 1000 + 5) }, json: { message: "API rate limit exceeded" } },
      { json: { login: "me" } },
    ]);
    expect(await client.viewerLogin()).toBe("me");
    expect(calls).toHaveLength(3);
    expect(sleeps[0]).toBe(3000);
    expect(sleeps[1]).toBe(2500);

    const f = make([
      { status: 429, headers: { "retry-after": "1" } },
      { status: 429, headers: { "retry-after": "1" } },
      { status: 429, headers: { "retry-after": "1" } },
    ]);
    await expect(f.client.viewerLogin()).rejects.toMatchObject({ code: "github" });
    expect(f.calls).toHaveLength(3);
  });

  it("does not wait for very long rate limits", async () => {
    const { client, calls } = make([{ status: 429, headers: { "retry-after": "3600" } }]);
    await expect(client.viewerLogin()).rejects.toMatchObject({ code: "github" });
    expect(calls).toHaveLength(1);
  });

  it("waits at least 1s between writes", async () => {
    const { client, sleeps } = make([
      { status: 201, json: { number: 1, html_url: "u1" } },
      { status: 201, json: { number: 2, html_url: "u2" } },
    ]);
    await client.createIssue({ title: "a" });
    await client.createIssue({ title: "b" });
    expect(sleeps).toEqual([1000]);
  });

  it("runs requests serially", async () => {
    let inFlight = 0;
    let max = 0;
    const f = (async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(JSON.stringify({ login: "x" }), { status: 200 });
    }) as any;
    const client = createGitHubClient({ token: "t", owner: "o", repo: "r", fetch: f });
    await Promise.all([client.listPullRequests(), client.listPullRequests(), client.listPullRequests()]);
    expect(max).toBe(1);
  });
});

describe("invitations", () => {
  it("invite: 201 invited, 204 already", async () => {
    const { client, calls } = make([{ status: 201, json: { id: 1 } }, { status: 204 }]);
    expect(await client.inviteCollaborator("bob")).toBe("invited");
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toBe("https://api.github.com/repos/Acme/Proj/collaborators/bob");
    expect(await client.inviteCollaborator("bob")).toBe("already");
  });

  it("invite 422 explains limits", async () => {
    const { client } = make([{ status: 422, json: { message: "Validation Failed" } }]);
    const e = await client.inviteCollaborator("bob").catch((x) => x);
    expect(e.code).toBe("github");
    expect(e.message).toContain("50");
  });

  it("accept matches repo case-insensitively", async () => {
    const { client, calls } = make([
      { json: [{ id: 1, repository: { full_name: "other/thing" } }, { id: 7, repository: { full_name: "acme/proj" } }] },
      { status: 204 },
    ]);
    expect(await client.acceptInvitationFor()).toBe("accepted");
    expect(calls[0]!.url).toContain("/user/repository_invitations");
    expect(calls[1]!.method).toBe("PATCH");
    expect(calls[1]!.url).toBe("https://api.github.com/user/repository_invitations/7");
  });

  it("accept returns none when no invitation matches", async () => {
    const { client, calls } = make([{ json: [{ id: 1, repository: { full_name: "other/thing" } }] }]);
    expect(await client.acceptInvitationFor()).toBe("none");
    expect(calls).toHaveLength(1);
  });
});

const infoData = (enabled: boolean, cats: any[] = []) =>
  gql({ repository: { id: "R_1", hasDiscussionsEnabled: enabled, discussionCategories: { nodes: cats } } });
const QA = { id: "C_qa", name: "Q&A", slug: "q-a", isAnswerable: true };
const GEN = { id: "C_gen", name: "General", slug: "general", isAnswerable: false };
const OTHER_ANS = { id: "C_o", name: "Help", slug: "help", isAnswerable: true };

describe("discussions", () => {
  it("getDiscussionsInfo prefers q-a, then first answerable, else none", async () => {
    const a = make([infoData(true, [GEN, OTHER_ANS, QA])]);
    const ia = await a.client.getDiscussionsInfo();
    expect(ia.qaCategoryId).toBe("C_qa");
    expect(ia.enabled).toBe(true);
    expect(ia.repositoryId).toBe("R_1");
    expect(a.calls[0]!.url).toBe("https://api.github.com/graphql");
    expect(a.calls[0]!.body.variables).toEqual({ owner: "Acme", repo: "Proj" });

    expect((await make([infoData(true, [GEN, OTHER_ANS])]).client.getDiscussionsInfo()).qaCategoryId).toBe("C_o");
    expect((await make([infoData(false, [GEN])]).client.getDiscussionsInfo()).qaCategoryId).toBeUndefined();
  });

  it("enableDiscussions patches the repo", async () => {
    const { client, calls } = make([{ json: {} }]);
    await client.enableDiscussions();
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("https://api.github.com/repos/Acme/Proj");
    expect(calls[0]!.body).toEqual({ has_discussions: true });
  });

  it("ensureLabels creates only missing labels", async () => {
    const { client, calls } = make([
      { json: [{ name: LABELS.question }, { name: "bug" }] },
      { status: 201, json: {} },
      { status: 201, json: {} },
    ]);
    expect(await client.ensureLabels()).toEqual([LABELS.disagreement, LABELS.task]);
    expect(calls).toHaveLength(3);
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.url).toBe("https://api.github.com/repos/Acme/Proj/labels");
    expect(calls[1]!.body.name).toBe(LABELS.disagreement);
  });

  it("createDiscussion: mutation with waiting line, then label", async () => {
    const { client, calls } = make([
      infoData(true, [QA]),
      gql({ repository: { label: { id: "L_q" } } }),
      gql({ createDiscussion: { discussion: { id: "D_1", number: 5, url: "https://x/5" } } }),
      gql({ addLabelsToLabelable: { clientMutationId: null } }),
    ]);
    const r = await client.createDiscussion({ kind: "question", title: "T", body: "Body", waitingOn: ["a", "b"] });
    expect(r).toEqual({ id: "D_1", number: 5, url: "https://x/5" });
    const m1 = calls[2]!.body;
    expect(m1.query).toContain("createDiscussion");
    expect(m1.variables).toEqual({ repositoryId: "R_1", categoryId: "C_qa", title: "T", body: "等：@a @b\n\nBody" });
    const m2 = calls[3]!.body;
    expect(m2.query).toContain("addLabelsToLabelable");
    expect(m2.variables).toEqual({ labelableId: "D_1", labelIds: ["L_q"] });
    expect(calls[1]!.body.variables.name).toBe(LABELS.question);
  });

  it("createDiscussion omits waiting line when nobody is waited on", async () => {
    const { client, calls } = make([
      infoData(true, [QA]),
      gql({ repository: { label: { id: "L_d" } } }),
      gql({ createDiscussion: { discussion: { id: "D_1", number: 5, url: "u" } } }),
      gql({ addLabelsToLabelable: {} }),
    ]);
    await client.createDiscussion({ kind: "disagreement", title: "T", body: "Body", waitingOn: [] });
    expect(calls[2]!.body.variables.body).toBe("Body");
  });

  it("createDiscussion creates labels when missing", async () => {
    const { client, calls } = make([
      infoData(true, [QA]),
      gql({ repository: { label: null } }),
      { json: [] },
      { status: 201, json: {} },
      { status: 201, json: {} },
      { status: 201, json: {} },
      gql({ repository: { label: { id: "L_q" } } }),
      gql({ createDiscussion: { discussion: { id: "D_1", number: 5, url: "u" } } }),
      gql({ addLabelsToLabelable: {} }),
    ]);
    await client.createDiscussion({ kind: "question", title: "T", body: "B", waitingOn: [] });
    expect(calls.filter((c) => c.url.endsWith("/labels") && c.method === "POST")).toHaveLength(3);
  });

  it("createDiscussion when disabled throws needs_human", async () => {
    const { client } = make([infoData(false, [])]);
    await expect(client.createDiscussion({ kind: "question", title: "T", body: "B", waitingOn: [] })).rejects.toMatchObject({
      code: "needs_human",
    });
  });

  it("createDiscussionOrIssue falls back to an issue with the label", async () => {
    const { client, calls } = make([infoData(false, []), { status: 201, json: { number: 9, html_url: "https://x/issues/9" } }]);
    const r = await createDiscussionOrIssue(client, { kind: "disagreement", title: "T", body: "B", waitingOn: ["a"] });
    expect(r).toEqual({ kind: "issue", number: 9, url: "https://x/issues/9" });
    expect(calls[1]!.url).toBe("https://api.github.com/repos/Acme/Proj/issues");
    expect(calls[1]!.body).toEqual({ title: "T", body: "等：@a\n\nB", labels: [LABELS.disagreement] });
  });

  it("createDiscussionOrIssue returns a discussion when enabled and rethrows other errors", async () => {
    const ok = make([
      infoData(true, [QA]),
      gql({ repository: { label: { id: "L" } } }),
      gql({ createDiscussion: { discussion: { id: "D", number: 2, url: "u2" } } }),
      gql({ addLabelsToLabelable: {} }),
    ]);
    expect(await createDiscussionOrIssue(ok.client, { kind: "question", title: "T", body: "B", waitingOn: [] })).toEqual({
      kind: "discussion",
      number: 2,
      url: "u2",
    });
    const bad = make([{ status: 401, json: {} }]);
    await expect(createDiscussionOrIssue(bad.client, { kind: "question", title: "T", body: "B", waitingOn: [] })).rejects.toMatchObject({
      code: "auth",
    });
  });

  it("commentOnDiscussion and closeDiscussion resolve the node id first", async () => {
    const { client, calls } = make([
      gql({ repository: { discussion: { id: "D_9" } } }),
      gql({ addDiscussionComment: { comment: { id: "c" } } }),
      gql({ repository: { discussion: { id: "D_9" } } }),
      gql({ closeDiscussion: { discussion: { id: "D_9" } } }),
    ]);
    await client.commentOnDiscussion(9, "hi");
    await client.closeDiscussion(9, "RESOLVED");
    expect(calls[0]!.body.variables).toEqual({ owner: "Acme", repo: "Proj", number: 9 });
    expect(calls[1]!.body.variables).toEqual({ discussionId: "D_9", body: "hi" });
    expect(calls[3]!.body.variables).toEqual({ discussionId: "D_9", reason: "RESOLVED" });
  });

  it("GraphQL FORBIDDEN errors become needs_human", async () => {
    const { client } = make([{ json: { errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] } }]);
    await expect(client.getDiscussionsInfo()).rejects.toMatchObject({ code: "needs_human" });
  });

  const node = (o: any) => ({
    id: "D_" + o.number,
    title: "t",
    url: "u",
    body: "",
    closed: false,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-02T00:00:00Z",
    author: { login: "alice" },
    answer: null,
    labels: { nodes: [] },
    comments: { nodes: [] },
    ...o,
  });

  it("listDiscussions maps fields; closed excluded unless recent", async () => {
    const { client, calls } = make([
      gql({
        repository: {
          discussions: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              node({
                number: 1,
                body: "等: @bob @carol\n\nq",
                labels: { nodes: [{ name: LABELS.question }] },
                comments: { nodes: [{ author: { login: "alice" } }, { author: { login: "bob" } }, { author: { login: "bob" } }, { author: null }] },
                answer: { id: "a" },
              }),
              node({ number: 2, closed: true, updatedAt: "2026-10-01T00:00:00Z" }),
              node({ number: 3, closed: true, updatedAt: "2026-11-10T00:00:00Z", labels: { nodes: [{ name: LABELS.disagreement }] } }),
            ],
          },
        },
      }),
    ]);
    const list = await client.listDiscussions({ includeClosedSince: "2026-11-05T00:00:00Z" });
    expect(list.map((d) => d.number)).toEqual([1, 3]);
    expect(list[0]).toMatchObject({
      kind: "question",
      author: "alice",
      waitingOn: ["bob", "carol"],
      commenters: ["bob"],
      answered: true,
      closed: false,
    });
    expect(list[1]).toMatchObject({ kind: "disagreement", closed: true, waitingOn: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.query).toContain("comments(first:50)");

    const { client: c2 } = make([
      gql({ repository: { discussions: { pageInfo: { hasNextPage: false }, nodes: [node({ number: 1 }), node({ number: 2, closed: true })] } } }),
    ]);
    expect((await c2.listDiscussions()).map((d) => d.number)).toEqual([1]);
  });
});

describe("issues and pull requests", () => {
  const issue = (o: any) => ({
    number: 1,
    title: "t",
    html_url: "u",
    state: "open",
    assignees: [{ login: "bob" }],
    labels: [{ name: LABELS.task }, "plain"],
    user: { login: "alice" },
    created_at: "c",
    updated_at: "u",
    closed_at: null,
    ...o,
  });

  it("createIssue posts title, body, assignees, labels", async () => {
    const { client, calls } = make([{ status: 201, json: { number: 4, html_url: "https://x/4" } }]);
    expect(await client.createIssue({ title: "T", body: "B", assignees: ["bob"], labels: [LABELS.task] })).toEqual({
      number: 4,
      url: "https://x/4",
    });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://api.github.com/repos/Acme/Proj/issues");
    expect(calls[0]!.body).toEqual({ title: "T", body: "B", assignees: ["bob"], labels: [LABELS.task] });
  });

  it("listIssues excludes PRs, maps blockedBy (open only) and sends since", async () => {
    const { client, calls } = make([
      {
        json: [
          issue({ number: 1 }),
          issue({ number: 2, pull_request: {} }),
          issue({ number: 3, state: "closed", closed_at: "z" }),
        ],
        headers: { etag: 'W/"abc"' },
      },
      gql({
        repository: {
          issues: {
            nodes: [
              { number: 1, blockedBy: { nodes: [{ number: 8, state: "OPEN" }, { number: 9, state: "CLOSED" }] } },
              { number: 5, blockedBy: { nodes: [] } },
            ],
          },
        },
      }),
    ]);
    const list = await client.listIssues({ since: "2026-11-01T00:00:00Z", state: "all" });
    expect(calls[0]!.url).toContain("/repos/Acme/Proj/issues?");
    expect(calls[0]!.url).toContain("state=all");
    expect(calls[0]!.url).toContain("since=2026-11-01T00%3A00%3A00Z");
    expect(list.map((t) => t.number)).toEqual([1, 3]);
    expect(list[0]).toMatchObject({ state: "open", assignees: ["bob"], labels: [LABELS.task, "plain"], author: "alice", blockedBy: [8] });
    expect(list[1]).toMatchObject({ state: "closed", closedAt: "z", blockedBy: [] });
    expect(calls[1]!.body.query).toContain("blockedBy");
  });

  it("listIssues skips dependency query when nothing is open, and tolerates its failure", async () => {
    const a = make([{ json: [issue({ number: 3, state: "closed" })] }]);
    await a.client.listIssues({ state: "all" });
    expect(a.calls).toHaveLength(1);

    const b = make([{ json: [issue({ number: 1 })] }, { json: { errors: [{ message: "Field 'blockedBy' doesn't exist" }] } }]);
    expect((await b.client.listIssues())[0]!.blockedBy).toEqual([]);
  });

  it("listIssues uses ETag and serves cached body on 304", async () => {
    const cache = createMemoryEtagCache();
    const first = make(
      [{ json: [issue({ number: 1 })], headers: { etag: '"v1"' } }, gql({ repository: { issues: { nodes: [] } } })],
      { cache },
    );
    await first.client.listIssues();
    expect(first.calls[0]!.headers["if-none-match"]).toBeUndefined();
    expect(cache.get(first.calls[0]!.url)?.etag).toBe('"v1"');

    const second = make([{ status: 304 }, gql({ repository: { issues: { nodes: [] } } })], { cache });
    const list = await second.client.listIssues();
    expect(second.calls[0]!.headers["if-none-match"]).toBe('"v1"');
    expect(list.map((t) => t.number)).toEqual([1]);
  });

  it("listPullRequests maps merged state and reviewers", async () => {
    const pr = (o: any) => ({
      number: 1,
      title: "t",
      html_url: "u",
      user: { login: "alice" },
      state: "open",
      draft: false,
      requested_reviewers: [{ login: "bob" }],
      created_at: "c",
      updated_at: "u",
      merged_at: null,
      ...o,
    });
    const { client, calls } = make([
      { json: [pr({}), pr({ number: 2, state: "closed", merged_at: "m" }), pr({ number: 3, state: "closed" }), pr({ number: 4, draft: true })] },
    ]);
    const list = await client.listPullRequests({ state: "all" });
    expect(calls[0]!.url).toContain("/repos/Acme/Proj/pulls?state=all");
    expect(list.map((p) => p.state)).toEqual(["open", "merged", "closed", "open"]);
    expect(list[0]!.requestedReviewers).toEqual(["bob"]);
    expect(list[1]!.mergedAt).toBe("m");
    expect(list[3]!.draft).toBe(true);
  });
});
