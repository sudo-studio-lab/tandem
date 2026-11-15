import { describe, expect, it } from "vitest";
import { getGitHubToken } from "../github/token.ts";
import { pollDeviceLogin, startDeviceLogin } from "./device.ts";
import { GITHUB_OAUTH_CLIENT_ID, getGitHubClientId } from "./config.ts";

function fakeFetch(json: unknown, status = 200) {
  const calls: { url: string; body: any; headers: any }[] = [];
  const f = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("device flow", () => {
  it("uses the built-in public client id when env is unset", () => {
    expect(getGitHubClientId({})).toBe(GITHUB_OAUTH_CLIENT_ID);
    expect(getGitHubClientId({ TANDEM_GITHUB_CLIENT_ID: "  " })).toBe(GITHUB_OAUTH_CLIENT_ID);
  });

  it("env overrides the client id", () => {
    expect(getGitHubClientId({ TANDEM_GITHUB_CLIENT_ID: " abc " })).toBe("abc");
  });

  it("starts a login with default scopes", async () => {
    const { f, calls } = fakeFetch({
      device_code: "dc1",
      user_code: "WDJB-MJHT",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
    const r = await startDeviceLogin({ clientId: "cid", fetch: f });
    expect(r).toEqual({ deviceCode: "dc1", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 });
    expect(calls[0]!.url).toBe("https://github.com/login/device/code");
    expect(calls[0]!.body).toEqual({ client_id: "cid", scope: "repo read:org" });
    expect(calls[0]!.headers.accept).toBe("application/json");
  });

  it("maps poll responses", async () => {
    const poll = (j: unknown) => pollDeviceLogin("dc1", { clientId: "cid", fetch: fakeFetch(j).f });
    expect(await poll({ error: "authorization_pending" })).toEqual({ state: "pending" });
    expect(await poll({ error: "slow_down", interval: 10 })).toEqual({ state: "slow_down", interval: 10 });
    expect(await poll({ error: "expired_token" })).toEqual({ state: "expired" });
    expect(await poll({ error: "access_denied" })).toEqual({ state: "denied" });
    expect(await poll({ access_token: "gho_x", token_type: "bearer", scope: "repo" })).toEqual({ state: "done", token: "gho_x" });
    expect(await poll({ error: "incorrect_client_credentials", error_description: "bad" })).toEqual({ state: "error", message: "bad" });
  });

  it("sends the device grant type", async () => {
    const { f, calls } = fakeFetch({ error: "authorization_pending" });
    await pollDeviceLogin("dc1", { clientId: "cid", fetch: f });
    expect(calls[0]!.url).toBe("https://github.com/login/oauth/access_token");
    expect(calls[0]!.body).toEqual({ client_id: "cid", device_code: "dc1", grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  });

  it("reports offline as an error state when polling", async () => {
    const f = (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch;
    expect(await pollDeviceLogin("dc", { clientId: "c", fetch: f })).toMatchObject({ state: "error" });
  });
});

describe("token resolution", () => {
  it("env, then keyring, then gh", async () => {
    expect(await getGitHubToken({ TANDEM_TOKEN: "e" }, async () => "g", () => "k")).toEqual({ token: "e", source: "env" });
    expect(await getGitHubToken({}, async () => "g", () => "k")).toEqual({ token: "k", source: "keyring" });
    expect(await getGitHubToken({}, async () => "g", () => null)).toEqual({ token: "g", source: "gh" });
    await expect(getGitHubToken({}, async () => undefined, () => null)).rejects.toMatchObject({ code: "auth" });
  });
});
