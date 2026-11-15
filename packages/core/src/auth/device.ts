import { TandemError } from "@tandem/contracts";
import { getGitHubClientId } from "./config.ts";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

export interface DeviceLoginStartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the device code expires. */
  expiresIn: number;
  /** Minimum seconds between polls. */
  interval: number;
}

export type DevicePollResult =
  | { state: "pending" }
  | { state: "slow_down"; interval?: number }
  | { state: "done"; token: string }
  | { state: "expired" }
  | { state: "denied" }
  | { state: "error"; message: string };

interface DeviceOpts {
  fetch?: typeof fetch;
  /** Test hook; defaults to env/config. */
  clientId?: string;
}

async function postJson(doFetch: typeof fetch, url: string, body: Record<string, string>): Promise<any> {
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "tandem" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TandemError("offline", "連不上 GitHub。請檢查網路連線後再試");
  }
  let json: any;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }
  if (!json || typeof json !== "object") {
    throw new TandemError("github", `GitHub 登入服務回傳了無法理解的內容（HTTP ${res.status}）`);
  }
  return json;
}

/** Step 1 of the OAuth device flow (no client secret). */
export async function startDeviceLogin(opts: { scopes?: string[] } & DeviceOpts = {}): Promise<DeviceLoginStartResult> {
  const clientId = opts.clientId ?? getGitHubClientId();
  if (!clientId) {
    throw new TandemError(
      "auth",
      "這個版本還沒有設定 GitHub 登入（缺少 Client ID）。請先用 gh auth login 登入，或設定環境變數 TANDEM_TOKEN",
    );
  }
  const scopes = opts.scopes ?? ["repo", "read:org"];
  const j = await postJson(opts.fetch ?? globalThis.fetch, DEVICE_CODE_URL, { client_id: clientId, scope: scopes.join(" ") });
  if (j.error || !j.device_code) {
    throw new TandemError("auth", `無法開始 GitHub 登入：${j.error_description ?? j.error ?? "沒有取得驗證碼"}`);
  }
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri,
    expiresIn: Number(j.expires_in) || 900,
    interval: Number(j.interval) || 5,
  };
}

/** Step 2: poll once. The caller waits `interval` seconds between calls (and longer after slow_down). */
export async function pollDeviceLogin(deviceCode: string, opts: DeviceOpts = {}): Promise<DevicePollResult> {
  const clientId = opts.clientId ?? getGitHubClientId();
  if (!clientId) return { state: "error", message: "尚未設定 GitHub 登入（缺少 Client ID）" };
  let j: any;
  try {
    j = await postJson(opts.fetch ?? globalThis.fetch, TOKEN_URL, {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
  if (typeof j.access_token === "string" && j.access_token) return { state: "done", token: j.access_token };
  switch (j.error) {
    case "authorization_pending":
      return { state: "pending" };
    case "slow_down":
      return typeof j.interval === "number" ? { state: "slow_down", interval: j.interval } : { state: "slow_down" };
    case "expired_token":
      return { state: "expired" };
    case "access_denied":
      return { state: "denied" };
    default:
      return { state: "error", message: String(j.error_description ?? j.error ?? "GitHub 登入失敗") };
  }
}
