export type TandemErrorCode = "usage" | "validation" | "not_a_repo" | "no_remote" | "auth" | "needs_human" | "conflict" | "offline" | "github" | "internal";

export class TandemError extends Error {
  readonly code: TandemErrorCode;
  readonly details?: unknown;
  constructor(code: TandemErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "TandemError";
    this.code = code;
    this.details = details;
  }
}
