const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** tandem://join?repo=owner/name → "owner/name", or null for anything else. */
export function parseJoinLink(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "tandem:" || u.hostname.toLowerCase() !== "join") return null;
  const repo = u.searchParams.get("repo");
  if (!repo) return null;
  const parts = repo.split("/");
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") return null;
  return `${owner}/${name}`;
}

export function findDeepLink(argv: string[]): string | null {
  return argv.find((a) => a.toLowerCase().startsWith("tandem:")) ?? null;
}

/** The link secret stays in the fragment; it must never enter an HTTP query or a log. */
export function parseJoinSecret(raw:string):string|null {
  if(!parseJoinLink(raw))return null;
  try{const value=new URLSearchParams(new URL(raw).hash.slice(1)).get("share");return value&&/^[A-Za-z0-9_-]{43}$/.test(value)?value:null;}catch{return null;}
}

/** Only https URLs may leave the app. */
export function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
