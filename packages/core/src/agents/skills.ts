import { PRODUCT } from "@tandem/contracts";
import { SKILL_VERSION } from "./text.ts";

const C = PRODUCT.command;
const T = PRODUCT.displayName;

export interface SkillDef {
  /** Short name; folder and `name` are `${PRODUCT.skillPrefix}${short}`. */
  short: "decision" | "status" | "ask";
  description: string;
  body: string;
}

export const SKILL_MARKER = `<!-- tandem-skill v:${SKILL_VERSION} -->`;

const decisionBody = `# 記錄決定

使用者說出一個會影響別人的決定時，用這個技能把它記進 ${T}。

有 \`${C}_decide\` 工具時直接用它（欄位跟下面的 JSON 一樣，\`dryRun\` 預設是 true，確認後再用 \`dryRun: false\` 呼叫一次）；沒有才用下面的指令。

## 什麼算「會影響別人的決定」

- 選了做法、方向、技術、範圍（「就這樣」「好，用 X」「我們決定不做 Y」）。
- 別人的工作會因此改變，或之後有人會問「當初為什麼這樣」。
- 不算：只影響使用者自己這一刻的小選擇（變數取什麼名字、先改哪個檔案）。拿不準就問使用者一句：「這個要記給團隊嗎？」

## 1. 抓逐字原話

- 從對話裡**複製**使用者決定時說的那一句，一字不改。
- 不翻譯、不整理、不補標點、不修錯字、不把口語改成書面語。「好 那就用sqlite吧」就記「好 那就用sqlite吧」。
- 如果決定是好幾句話一起構成的，每句各放一則 quote。
- 原話是別人說的（使用者轉述）：要有那句話的網址；沒有網址就加 \`relayedBy\` 標成轉述。
- 完全沒有原話（例如是 agent 根據文件整理的）：\`quotes\` 留空，\`noQuoteBy\` 填使用者的 GitHub 帳號。不要編一句原話。

## 2. 判斷強度（strength）

| 值 | 什麼時候用 | 使用者通常這樣說 |
|---|---|---|
| \`hard\` | 不能違反的限制（法規、預算、對外承諾） | 「一定要」「絕對不能」「客戶要求」 |
| \`preference\` | 有理由的選擇，遇到更好的理由可以改 | 「就用這個」「我們決定…」 |
| \`hunch\` | 直覺、還沒驗證 | 「我覺得」「先這樣試試」 |
| \`one-off\` | 只適用這一次，不是長期規則 | 「這次先…」「這個案子…」 |

拿不準時選比較弱的，並在回條裡問使用者：「我記成偏好，不是硬性規定，對嗎？」

## 3. 先產生草稿，再問回條

1. 準備 JSON，用 \`--dry-run\` 產生完整紀錄（不會寫入）：

\`\`\`bash
${C} decide --input - --dry-run <<'EOF'
{
  "title": "第一版先做本機網頁，不做桌面程式",
  "slug": "local-web-first",
  "deciders": ["alice"],
  "strength": "preference",
  "source": "chat",
  "area": "架構",
  "quotes": [
    { "by": "alice", "text": "好 先做網頁就好 桌面版之後再說", "source": "chat" }
  ],
  "decision": "第一版只做在瀏覽器開啟的本機看板，桌面程式留到之後。",
  "why": "網頁版可以最快讓團隊用起來，桌面版需要另外處理安裝和更新。",
  "optionsConsidered": "一開始就做桌面程式：成本高，而且還不確定需求。",
  "scope": "第一版上線前有效；有人想先做桌面版時重新檢視。",
  "supersedes": []
}
EOF
\`\`\`

2. 把結果給使用者看，用白話講重點（誰決定、決定什麼、原話），然後問：

   **「我記成這樣，對嗎？」**

3. 使用者說對 → 去掉 \`--dry-run\` 重新執行同一份 JSON（\`${C} decide --input -\`）。
4. 使用者說有錯 → 只改使用者指出的地方，再跑一次 \`--dry-run\` 給使用者看。原話絕不因為使用者說「改好看一點」而改寫；使用者要改的話，請使用者親自再說一次，用新的那句。
5. 如果指令回傳驗證錯誤，照錯誤訊息補欄位，不要略過驗證。

## 欄位提醒

- \`deciders\`：做決定的人的 GitHub 帳號；通常是使用者自己。
- \`consulted\`：決定前有問過意見的人。
- \`source\`：\`"chat"\`（在這個對話裡決定的）或網址（在 issue、會議紀錄等地方決定的）。
- \`supersedes\`：這個決定取代舊決定時，填舊決定的編號（例如 \`D-20261115-k3f9\`）。不要去改舊決定的檔案。
- \`slug\`：英文小寫加連字號；標題不是英文時請自己給。

## 不要做

- 不要替使用者做決定，也不要把你的建議當成使用者的決定記下來。
- 不要改別人的決定或別人的狀態檔。
- 不要在沒有使用者確認的情況下正式寫入。
`;

const statusBody = `# 更新自己的狀態

一段工作告一段落、或使用者準備結束對話前，用這個技能更新使用者自己的狀態。只會寫使用者自己的狀態檔，不碰別人的。

有 \`${C}_status\` 工具時直接用它（欄位跟下面的參數一樣）；沒有才用下面的指令。

## 什麼時候做

- 完成了一個段落（功能做完、問題解決、方向改變）。
- 使用者說「先這樣」「今天到這」「收工」。
- 被擋住了、或解除了阻擋。
- 有成品可以讓別人看（網頁、文件、PR）。

這次對話什麼都沒動，就不用更新。

## 好的狀態長什麼樣

每個欄位給**不在現場的隊友**看，讓對方十秒內知道要不要找你。

- \`--doing\`：正在做什麼，一句話，講結果不講過程。好：「把登入改成用 GitHub 帳號，剩測試」。不好：「在改程式」。
- \`--next\`：接下來做什麼。沒有就不填。
- \`--blocked\`：被什麼擋住、在等誰。沒被擋住就傳空字串 \`""\` 清掉舊的。好：「等 bob 決定要不要支援私人 repo」。
- \`--fyi\`：別人應該知道、但不需要回應的事，最多 3 則。好：「狀態檔的格式改了，舊檔仍可讀」。
- \`--deliverable\`：成品連結，格式「標題=網址」，最多 5 個。

## 成品連結

- 有網址才放：PR、部署的預覽、文件、設計稿。不要放本機路徑或 localhost。
- 標題寫成品是什麼，不寫「連結」：\`--deliverable "登入改版 PR=https://github.com/org/repo/pull/12"\`。
- 同一個成品更新時，覆寫就好，不要重複放。

## 指令

\`\`\`bash
${C} status \\
  --doing "把登入改成用 GitHub 帳號，剩測試" \\
  --next "補測試後開 PR" \\
  --blocked "" \\
  --fyi "舊的登入方式還能用到下個版本" \\
  --deliverable "登入改版 PR=https://github.com/org/repo/pull/12"
\`\`\`

內容含引號或很長時，改用 \`${C} status --input -\` 從標準輸入傳 JSON。沒給的欄位保留原值。

## 注意

- 用使用者本人的名義寫，語氣是使用者自己會說的話。
- 不要編造進度；沒做完就寫沒做完。
- 如果這次對話中使用者做了影響別人的決定，先用 \`tandem-decision\` 技能記下來，再更新狀態。
- 需要別人回答才做得下去時，用 \`tandem-ask\` 技能，並把等待寫進 \`--blocked\`。
`;

const askBody = `# 向隊友提問，或直接記決定

工作卡住、需要別人的意見時，用這個技能判斷該「開問題」還是「直接記決定」。

有 \`${C}_ask\`、\`${C}_disagree\`、\`${C}_decisions\` 工具時直接用它們；沒有才用下面的指令。

## 判斷方式

先問自己：**如果之後對方不同意，改回來的成本高不高？**

| 情況 | 做法 |
|---|---|
| 可以先做、之後再改（改名、版面、先選一個預設值） | 直接做，用 \`tandem-decision\` 記成決定，讓對方事後看得到、想改再改。**不要開問題。** |
| 不回答就做不下去，或做錯了很難收拾（資料格式、對外承諾、花錢、會刪東西） | \`${C} ask\` |
| 兩個人已經意見不同 | \`${C} disagree\`，各自寫自己的立場 |
| 問題其實是使用者自己能決定的 | 問使用者，不要轉去煩別人 |

不確定時偏向直接記決定。開問題會讓別人被打斷，只在真的需要時才用。

## 開問題之前

1. 先看 \`${C} brief\` 或既有決定，確認沒有人已經回答過。
2. 告訴使用者你要問誰、問什麼，等使用者同意再送出：「我要問 bob：資料要不要加密？這樣可以嗎？」
3. 使用者同意後再執行。

## 好問題

- 一個問題只問一件事。
- 標題就是問句，對方不點開也知道要回答什麼。
- 內文寫：背景一兩句、你的建議、你需要對方在什麼時候前回答、不回答的話你會怎麼做。
- 給選項，讓對方可以只回「選 A」。

\`\`\`bash
${C} ask bob \\
  --title "匯出的檔案要加密嗎？" \\
  --body "背景：客戶可能把匯出檔寄給外部。我的建議：加密，密碼另外給。選項：A 加密、B 不加密。週五前要開始做匯出，沒回的話我先做 A，並記成決定。"
\`\`\`

指令會回傳討論網址，把網址告訴使用者，並用 \`tandem-status\` 技能把「等 bob」寫進 \`--blocked\`。

## 對方回答之後

- 在討論串裡得到答案，使用者同意採用：用 \`tandem-decision\` 記成決定，\`source\` 填討論的網址，原話用對方在討論串裡的**逐字**留言（有網址，\`by\` 是對方）。
- 然後 \`${C} resolve <討論網址或編號> --decision <決定編號>\` 結束討論。

## 不要做

- 不要用提問來取得其實不需要的許可。
- 不要同時問好幾個人同一件事。
- 不要把問題開在別人的狀態檔或決定裡。
`;

export const SKILLS: SkillDef[] = [
  {
    short: "decision",
    description: `使用者說出會影響別人的決定時使用（例如「就這樣」「好，用 X」「我們決定…」）。教你逐字抓原話、判斷強度，先用 ${C} decide --dry-run 產生紀錄並問「我記成這樣，對嗎？」，確認後再正式記錄。`,
    body: decisionBody,
  },
  {
    short: "status",
    description: `一段工作告一段落、或準備結束對話時使用。教你用 ${C} status 更新使用者自己的狀態：寫什麼才有用、被擋住怎麼寫、怎麼附上成品連結。`,
    body: statusBody,
  },
  {
    short: "ask",
    description: `工作卡在需要別人決定的事時使用。教你判斷該用 ${C} ask 開問題，還是直接用 ${C} decide 記下決定，以及怎麼把問題問好。`,
    body: askBody,
  },
];

export function skillDirName(def: SkillDef): string {
  return `${PRODUCT.skillPrefix}${def.short}`;
}

/** Full SKILL.md text (LF endings). Only `name` and `description` frontmatter. */
export function renderSkill(def: SkillDef): string {
  // A JSON string is a valid YAML double-quoted scalar.
  const desc = JSON.stringify(def.description);
  return `---\nname: ${skillDirName(def)}\ndescription: ${desc}\n---\n\n${def.body.trimEnd()}\n\n${SKILL_MARKER}\n`;
}
