import { describe, expect, it } from "vitest";
import { createGitHubClient, getGitHubToken } from "./index.ts";

// Read-only checks against the real repo. Run with TANDEM_LIVE=1.
describe.skipIf(process.env.TANDEM_LIVE !== "1")("live (read-only)", () => {
  async function client() {
    const { token } = await getGitHubToken();
    return createGitHubClient({ token, owner: "sudo-studio-lab", repo: "tandem" });
  }

  it("viewerLogin", async () => {
    const c = await client();
    const login = await c.viewerLogin();
    console.log("viewer:", login);
    expect(login.length).toBeGreaterThan(0);
  });

  it("getDiscussionsInfo", async () => {
    const info = await (await client()).getDiscussionsInfo();
    console.log("discussions:", JSON.stringify(info));
    expect(info.repositoryId).toBeTruthy();
    expect(Array.isArray(info.categories)).toBe(true);
  });

  it("listDiscussions", async () => {
    const list = await (await client()).listDiscussions({ includeClosedSince: "2000-01-01T00:00:00Z" });
    console.log("discussions count:", list.length, JSON.stringify(list.slice(0, 2)));
    expect(Array.isArray(list)).toBe(true);
  });

  it("listIssues", async () => {
    const list = await (await client()).listIssues({ state: "all" });
    console.log("issues count:", list.length, JSON.stringify(list.slice(0, 2)));
    expect(Array.isArray(list)).toBe(true);
  });

  it("listPullRequests", async () => {
    const list = await (await client()).listPullRequests({ state: "all" });
    console.log("prs count:", list.length, JSON.stringify(list.slice(0, 2)));
    expect(Array.isArray(list)).toBe(true);
  });
});
