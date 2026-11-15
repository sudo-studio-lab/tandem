import { execFile } from "node:child_process";
import { TandemError } from "@tandem/contracts";
import { loadToken } from "../auth/store.ts";

export type TokenSource = "env" | "keyring" | "gh";

function ghAuthToken(): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      execFile("gh", ["auth", "token"], { timeout: 10_000, windowsHide: true }, (err, stdout) => {
        if (err) return resolve(undefined);
        const t = String(stdout).trim();
        resolve(t || undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Order (research S5): env (TANDEM_TOKEN, then GH_TOKEN / GITHUB_TOKEN) → OS keyring → `gh auth token`.
 */
export async function getGitHubToken(
  env: NodeJS.ProcessEnv = process.env,
  runGh: () => Promise<string | undefined> = ghAuthToken,
  readKeyring: () => string | null | Promise<string | null> = loadToken,
): Promise<{ token: string; source: TokenSource }> {
  for (const name of ["TANDEM_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) {
    const v = env[name]?.trim();
    if (v) return { token: v, source: "env" };
  }
  const k = await readKeyring();
  if (k) return { token: k, source: "keyring" };
  const t = await runGh();
  if (t) return { token: t, source: "gh" };
  throw new TandemError("auth", "找不到 GitHub 登入。請先執行 gh auth login");
}
