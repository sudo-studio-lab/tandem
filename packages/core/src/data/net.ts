import { TandemError } from "@tandem/contracts";

export const NETWORK_RE =
  /could not resolve host|connection refused|failed to connect|timed out|network is unreachable|connection reset|could not read from remote repository|unable to connect|temporary failure in name resolution|no route to host|ssl connect error/i;

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TandemError) {
    const stderr = (err.details as { stderr?: string } | undefined)?.stderr;
    return NETWORK_RE.test(stderr ?? err.message);
  }
  return false;
}

/** Repo-relative path check shared by the stores. */
export function assertRelPath(p: string): void {
  if (!p || p.startsWith("/") || p.includes("\\") || /(^|\/)\.\.?(\/|$)/.test(p) || /^[a-zA-Z]:/.test(p) || p.includes("\0")) {
    throw new TandemError("validation", `不合法的路徑：${p}`);
  }
}
