/**
 * Secret guard: does this text look like it contains credentials? Used before anything is written
 * to shared team storage (context files now; agent messages later). Pure, no I/O, so the web mock
 * can import it too. Never returns or logs the secret itself.
 */

export interface SecretHit {
  /** What it looks like, e.g. "GitHub token". */
  kind: string;
  /** 1-based line number. */
  line: number;
}

interface Pattern {
  kind: string;
  re: RegExp;
  /** Extra check on the matched value (group 1 when present, else the whole match). */
  check?: (value: string) => boolean;
}

/** Shannon entropy in bits per character. */
function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PLACEHOLDER_RE =
  /^(?:x{3,}.*|\*{3,}.*|<.*>|\$\{?.*|%.*%|\{\{.*\}\}|.*(?:your|example|sample|placeholder|changeme|dummy|redacted|replace|xxxx|\.\.\.).*)$/i;

/** Long, random-looking, not a placeholder or a reference to another variable. */
export function looksLikeSecretValue(value: string, minLength = 16): boolean {
  const v = value.trim();
  if (v.length < minLength) return false;
  if (PLACEHOLDER_RE.test(v)) return false;
  if (/^(?:true|false|null|none|undefined)$/i.test(v)) return false;
  if (/^https?:\/\//i.test(v)) return false;
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return false;
  return entropy(v) >= 3;
}

const SECRET_NAME_RE = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|PWD|CREDENTIAL|AUTH|PRIVATE|API)/i;

const PATTERNS: Pattern[] = [
  { kind: "私鑰（PEM）", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { kind: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/ },
  { kind: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  {
    kind: "OpenAI API key",
    re: /\bsk-(?!ant-)((?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,})/,
    check: (v) => looksLikeSecretValue(v, 20),
  },
  { kind: "AWS access key", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/ },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { kind: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { kind: "Stripe key", re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/ },
  {
    kind: "網址裡的密碼",
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]{6,})@/i,
    check: (v) => !PLACEHOLDER_RE.test(v) && !/^(?:password|passwd|pass|secret|pwd)$/i.test(v),
  },
  {
    // .env / YAML / JSON style:  API_KEY=...,  apiKey: "...",  "client_secret": "..."
    kind: "金鑰設定（KEY=…）",
    re: /^\s*(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*[=:]\s*["']?([^\s"',#]+)/,
  },
];

/** Every line that looks like it holds a credential (at most one hit per line). */
export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const p of PATTERNS) {
      const m = p.re.exec(line);
      if (!m) continue;
      if (p.kind.startsWith("金鑰設定")) {
        const [, name = "", value = ""] = m;
        if (!SECRET_NAME_RE.test(name) || !looksLikeSecretValue(value)) continue;
      } else if (p.check && !p.check(m[1] ?? m[0])) continue;
      hits.push({ kind: p.kind, line: i + 1 });
      break;
    }
  });
  return hits;
}

/** Short Chinese explanation for people and agents; null when nothing was found. */
export function describeSecrets(hits: SecretHit[], where = "內容"): string | null {
  if (hits.length === 0) return null;
  const shown = hits
    .slice(0, 3)
    .map((h) => `第 ${h.line} 行：${h.kind}`)
    .join("、");
  return `${where}看起來有金鑰或密碼（${shown}${hits.length > 3 ? " 等" : ""}），所以沒有存。請拿掉再試；金鑰請放在自己電腦的環境變數或密碼管理工具。`;
}
