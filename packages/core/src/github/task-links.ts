/** Closing references for this repository only; code examples do not create task links. */
export function closingIssueNumbers(body: string, repo: string): number[] {
  const text = body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, "");
  const result = new Set<number>();
  const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?:\s*:\s*|\s+)(?:(https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/)|(\b[\w.-]+\/[\w.-]+)#|#)(\d+)\b/gi;
  for (const m of text.matchAll(pattern)) {
    const target = m[2] ?? m[3];
    if (target && target.toLowerCase() !== repo.toLowerCase()) continue;
    const n=Number(m[4]);if(Number.isSafeInteger(n)&&n>0)result.add(n);
  }
  return [...result];
}
