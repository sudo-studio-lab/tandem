import { Entry } from "@napi-rs/keyring";

const SERVICE = "Tandem";
const ACCOUNT = "github";

function warn(what: string, e: unknown): void {
  // Only the keyring's error message; never a token value.
  console.warn(`[tandem] ${what}：${e instanceof Error ? e.message : String(e)}`);
}

function entry(): Entry | null {
  try {
    return new Entry(SERVICE, ACCOUNT);
  } catch (e) {
    warn("無法使用系統的認證管理員", e);
    return null;
  }
}

/** Save the GitHub token in the OS credential store. Returns false when it could not be saved. */
export function saveToken(token: string): boolean {
  const e = entry();
  if (!e) return false;
  try {
    e.setPassword(token);
    return true;
  } catch (err) {
    warn("無法把登入權杖存進認證管理員", err);
    return false;
  }
}

/** Null when nothing is stored or the keyring is unavailable. */
export function loadToken(): string | null {
  const e = entry();
  if (!e) return null;
  try {
    const t = e.getPassword();
    return t ? t : null;
  } catch (err) {
    warn("無法從認證管理員讀取登入權杖", err);
    return null;
  }
}

/** Remove the stored token. No-op when none or unavailable. */
export function clearToken(): void {
  const e = entry();
  if (!e) return;
  try {
    e.deletePassword();
  } catch (err) {
    warn("無法從認證管理員刪除登入權杖", err);
  }
}
