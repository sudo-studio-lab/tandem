import { execFile } from "node:child_process";
import { TandemError } from "@tandem/contracts";

export type TokenSource = "env" | "gh";

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
 * Decision D-20261115-w7m2: 001 borrows the gh login.
 * Order: TANDEM_TOKEN, GH_TOKEN, GITHUB_TOKEN, `gh auth token`.
 */
export async function getGitHubToken(
  env: NodeJS.ProcessEnv = process.env,
  runGh: () => Promise<string | undefined> = ghAuthToken,
): Promise<{ token: string; source: TokenSource }> {
  for (const name of ["TANDEM_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) {
    const v = env[name]?.trim();
    if (v) return { token: v, source: "env" };
  }
  const t = await runGh();
  if (t) return { token: t, source: "gh" };
  throw new TandemError("auth", "找不到 GitHub 登入。請先執行 gh auth login");
}
