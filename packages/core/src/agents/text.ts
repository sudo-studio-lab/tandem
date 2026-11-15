import { createHash } from "node:crypto";
import { PRODUCT } from "@tandem/contracts";

export const BLOCK_VERSION = 1;
export const SKILL_VERSION = 1;
const M = PRODUCT.markerName;
const C = PRODUCT.command;

/** Body of the AGENTS.md managed block (LF line endings). Spec: agent-integration.md section 1. */
export const BLOCK_BODY = `## ${PRODUCT.displayName}（團隊協作）

這個專案用 ${PRODUCT.displayName} 讓每個人的 agent 共享決定和進度。

- **每次對話開始**：如果還沒看到 ${PRODUCT.displayName} 的報告，先執行 \`${C} brief\`，用五行以內把跟使用者有關的變動告訴使用者；沒有就不用講。
- **使用者做了會影響別人的決定**：用 \`${C} decide --dry-run\` 產生紀錄，給使用者看「我記成這樣，對嗎？」，確認後再正式執行。原話必須逐字，不能改寫。
- **需要別人回答才做得下去**：\`${C} ask\`。可以先做、之後再改的事，直接記決定，不要開問題。
- **結束工作前**：用 \`${C} status\` 更新使用者自己的狀態。
- 詳細做法：\`${C} brief\` 的輸出。不要改別人的狀態檔和別人的決定。`;

export function hash8(body: string): string {
  return createHash("sha256").update(body.replace(/\r\n/g, "\n")).digest("hex").slice(0, 8);
}

/** The managed block, LF endings, no trailing newline. */
export function buildBlock(): string {
  return `<!-- BEGIN ${M} v:${BLOCK_VERSION} hash:${hash8(BLOCK_BODY)} -->\n${BLOCK_BODY}\n<!-- END ${M} -->`;
}

export const BLOCK_RE = new RegExp(String.raw`<!-- BEGIN ${M} v:\d+ hash:[0-9a-f]+ -->[\s\S]*?<!-- END ${M} -->`);

export const CLAUDE_MD_CREATED = "@AGENTS.md\n";
export const CLAUDE_MD_BLOCK = `<!-- BEGIN ${M} -->\n@AGENTS.md\n<!-- END ${M} -->\n`;
export const CLAUDE_MD_BLOCK_RE = new RegExp(String.raw`<!-- BEGIN ${M} -->\r?\n@AGENTS\.md\r?\n<!-- END ${M} -->(?:\r?\n)?`);

export function detectEol(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}
export function toEol(text: string, eol: "\r\n" | "\n"): string {
  const lf = text.replace(/\r\n/g, "\n");
  return eol === "\n" ? lf : lf.replace(/\n/g, "\r\n");
}
