import { describe, expect, it } from "vitest";
import { createGitHubClient } from "./index.ts";

interface Call {
  method: string;
  url: string;
  body: any;
}
type Reply = { status?: number; json?: unknown };

function make(replies: (Reply | ((c: Call) => Reply))[]) {
  const calls: Call[] = [];
  const f = (async (url: any, init: any) => {
    const call: Call = { method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const r = replies.shift();
    if (!r) throw new Error(`unexpected call ${call.method} ${call.url}`);
    const rep = typeof r === "function" ? r(call) : r;
    return new Response(rep.json === undefined ? null : JSON.stringify(rep.json), { status: rep.status ?? 200 });
  }) as unknown as typeof fetch;
  const client = createGitHubClient({ token: "t", owner: "Acme", repo: "Proj", fetch: f, sleep: async () => {} });
  return { client, calls };
}

const repoRow = (full: string, push: boolean, priv = true) => ({
  full_name: full,
  name: full.split("/")[1],
  owner: { login: full.split("/")[0] },
  private: priv,
  pushed_at: "2026-11-14T00:00:00Z",
  permissions: { push },
});

describe("listMyRepos", () => {
  it("keeps pushable repos and filters by q", async () => {
    const { client, calls } = make([{ json: [repoRow("a/Alpha", true), repoRow("a/beta", false), repoRow("b/alphabet", true)] }]);
    const r = await client.listMyRepos({ q: "ALPHA" });
    expect(r.map((x) => x.fullName)).toEqual(["a/Alpha", "b/alphabet"]);
    expect(r[0]).toMatchObject({ owner: "a", name: "Alpha", private: true, pushedAt: "2026-11-14T00:00:00Z" });
    expect(calls[0]!.url).toContain("/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100&page=1");
  });

  it("follows at most 3 pages", async () => {
    const page = (n: number) => ({ json: Array.from({ length: 100 }, (_, i) => repoRow(`o/r${n}-${i}`, true)) });
    const { client, calls } = make([page(1), page(2), page(3), page(4)]);
    const r = await client.listMyRepos();
    expect(r).toHaveLength(300);
    expect(calls).toHaveLength(3);
  });
});

describe("listOwners", () => {
  it("returns the viewer then organizations", async () => {
    const { client } = make([{ json: { login: "me" } }, { json: [{ login: "org1" }, { login: "org2" }] }]);
    expect(await client.listOwners()).toEqual([
      { login: "me", kind: "user" },
      { login: "org1", kind: "org" },
      { login: "org2", kind: "org" },
    ]);
  });
});

describe("createRepo", () => {
  it("creates a private auto-init repo for a user", async () => {
    const { client, calls } = make([
      { status: 201, json: { name: "demo", full_name: "me/demo", owner: { login: "me" }, clone_url: "https://github.com/me/demo.git", default_branch: "main" } },
    ]);
    const r = await client.createRepo({ owner: "me", name: "demo", isOrg: false });
    expect(r).toEqual({ owner: "me", name: "demo", fullName: "me/demo", cloneUrl: "https://github.com/me/demo.git", defaultBranch: "main" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.github.com/user/repos", body: { name: "demo", private: true, auto_init: true } });
  });

  it("uses the org endpoint", async () => {
    const { client, calls } = make([{ status: 201, json: { name: "d", full_name: "org/d", owner: { login: "org" }, clone_url: "c", default_branch: "trunk" } }]);
    expect((await client.createRepo({ owner: "org", name: "d", isOrg: true })).defaultBranch).toBe("trunk");
    expect(calls[0]!.url).toBe("https://api.github.com/orgs/org/repos");
  });

  it("explains a 403 in plain words", async () => {
    const { client } = make([{ status: 403, json: { message: "nope" } }]);
    await expect(client.createRepo({ owner: "org", name: "d", isOrg: true })).rejects.toMatchObject({ code: "needs_human" });
  });
});

describe("invitations and repo info", () => {
  it("lists and accepts invitations", async () => {
    const { client, calls } = make([
      { json: [{ id: 5, created_at: "2026-11-13T00:00:00Z", inviter: { login: "alice" }, repository: { full_name: "o/r", name: "r", owner: { login: "o" }, private: true } }] },
      { status: 204 },
    ]);
    const inv = await client.listInvitations();
    expect(inv).toEqual([{ id: 5, repo: { owner: "o", name: "r", fullName: "o/r", private: true }, inviter: "alice", createdAt: "2026-11-13T00:00:00Z" }]);
    await client.acceptInvitation(5);
    expect(calls[1]).toMatchObject({ method: "PATCH", url: "https://api.github.com/user/repository_invitations/5" });
  });

  it("acceptInvitationFor still works", async () => {
    const { client } = make([{ json: [{ id: 9, repository: { full_name: "acme/proj" } }] }, { status: 204 }]);
    expect(await client.acceptInvitationFor()).toBe("accepted");
  });

  it("getRepo", async () => {
    const { client } = make([{ json: { default_branch: "trunk", private: true, permissions: { admin: false, push: true, pull: true } } }]);
    expect(await client.getRepo()).toEqual({ defaultBranch: "trunk", private: true, permissions: { admin: false, push: true, pull: true } });
  });
});

describe("getActivityRaw", () => {
  it("flattens the GraphQL and comments responses", async () => {
    const { client, calls } = make([
      {
        json: {
          data: {
            repository: {
              refs: {
                nodes: [
                  {
                    name: "main",
                    target: { history: { nodes: [{ oid: "o1", messageHeadline: "hi", committedDate: "2026-11-14T00:00:00Z", url: "u/o1", author: { user: { login: "alice" } } }, { oid: "o2", messageHeadline: "x", committedDate: "2026-11-14T01:00:00Z", url: "u/o2", author: { user: null } }] } },
                  },
                  { name: "empty", target: {} },
                ],
              },
              pullRequests: { nodes: [{ number: 1, title: "PR", url: "u/pr", createdAt: "c", mergedAt: null, author: { login: "bob" }, mergedBy: null }] },
              discussions: { nodes: [{ title: "討論", url: "u/d", comments: { nodes: [{ author: { login: "carol" }, createdAt: "t", url: "u/dc" }] } }] },
            },
          },
        },
      },
      { json: [{ user: { login: "dave" }, created_at: "t2", html_url: "u/ic", issue_url: "https://api.github.com/repos/Acme/Proj/issues/12" }] },
    ]);
    const raw = await client.getActivityRaw({ since: "2026-11-08T00:00:00Z" });
    expect(raw.commits.map((c) => [c.oid, c.branch, c.login])).toEqual([["o1", "main", "alice"], ["o2", "main", null]]);
    expect(raw.pullRequests[0]).toMatchObject({ author: "bob", mergedBy: null });
    expect(raw.comments).toEqual([
      { login: "carol", title: "討論", url: "u/dc", createdAt: "t" },
      { login: "dave", title: "#12", url: "u/ic", createdAt: "t2" },
    ]);
    expect(calls[0]!.body.variables).toEqual({ owner: "Acme", repo: "Proj", since: "2026-11-08T00:00:00Z" });
    expect(calls[1]!.url).toContain("/repos/Acme/Proj/issues/comments?since=2026-11-08T00%3A00%3A00Z");
  });
});
