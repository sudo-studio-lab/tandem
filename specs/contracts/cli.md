# `tandem` 指令說明

> **這是紀錄，不是定案。** 以 0.2.1 的 `apps/cli/src/main.ts`、`commands.ts`、`hook.ts` 為準。資料格式見 [../data-model.md](../data-model.md)。

## 共通慣例

參考 gh CLI 和 clig.dev：

- **輸出**：結果（資料、brief 文字、`--dry-run` 的檔案內容、分享文字）印到標準輸出；給人看的訊息、警告、錯誤印到標準錯誤。
- **`--json`**：大部分指令都有，輸出機器可讀的結果（格式見各指令）。agent 用這個。
- **`--input <檔案>` 或 `--input -`**：`decide`、`status` 可以用 JSON 傳入內容（`-` 代表從標準輸入讀）。原因：原話常含引號、中文、換行，直接放在參數裡容易被 Windows 的 shell 弄壞。檔案開頭的 BOM 會被忽略。
- **`--dry-run`**：`decide`、`status` 支援，只印出將要寫入的內容，不寫入。agent 用它做「回條」：先給使用者看，使用者說對再正式執行。
- **登入**：需要 GitHub 的指令依序找權杖：環境變數 `TANDEM_TOKEN`、`GH_TOKEN`、`GITHUB_TOKEN` → 作業系統認證管理員（桌面 app 登入後存的）→ `gh auth token`。指令本身沒有 login 子指令。
- **寫入紀錄**：會先存進本機待送區，再直接推到遠端預設分支；離線或被擋時留在本機，之後自動重送，並印出提醒。

### 結束代碼

| 代碼 | 意思 | 例子 |
|---|---|---|
| 0 | 成功 | |
| 1 | 錯誤 | 驗證不通過、`check` 有錯誤、`sync` 有衝突、`doctor` 有一項沒過、GitHub 或 git 失敗 |
| 2 | 用法錯誤 | `--input` 不是 JSON、`decide` 缺欄位、`join` 的 repo 格式不對、`resolve` 看不懂編號 |
| 3 | 需要人處理 | 沒有權限（例如要管理員到 GitHub 網頁開設定）、Discussions 沒有可用的 Q&A 分類 |

commander 自己檢查的參數錯誤（少了必填選項、不認得的選項）用它預設的代碼 1。

## 開始和加入

### `tandem`（＝ `tandem board`）

啟動本機伺服器（只聽 127.0.0.1，預設埠 4318，被占用就往後找）並用瀏覽器打開看板。在某個 GitHub repo 裡執行時，會把它記成專案並先顯示；不會自動執行 init。

- `--port <埠>`：指定埠。
- `--no-open`：不自動打開瀏覽器。

### `tandem serve`

給桌面 app 用（002）。啟動同一個伺服器，就緒時在標準輸出印一行 `{"ready":true,"port":…,"url":"…"}`。

- `--port <埠>`：`0` 代表自動挑（預設）。
- `--token-stdin`：從標準輸入讀一行當作通行碼。
- `--desktop`：桌面 app 模式。

### `tandem init`

在目前的 repo 開始使用 Tandem。可以重複執行，只會更新自己管理的部分。

會做的事：
1. 在遠端預設分支建立 `tandem/team.md`（已存在就不動）和自己的狀態檔。
2. 在 `AGENTS.md` 最上方加入或更新 Tandem 管理區塊（沒有就建立）；確保 `CLAUDE.md` 有 `@AGENTS.md`。
3. 寫入 Claude Code（`.claude/settings.json`）和 Codex（`.codex/hooks.json`）的 hook、兩家的技能檔、MCP 登記（`.mcp.json`、`.codex/config.toml`）。
4. 在 git pre-commit 加一段 `tandem check --quiet`。
5. 檢查 Discussions：沒開就問「要幫你開啟嗎？」（不是互動終端機時視為不同意）；不開就改用 Issues。建立三個 `tandem:` 標籤。
6. 把 agent 設定檔在目前分支上單獨 commit，並推送；如果這個分支上還有你自己沒推的 commit，就先不推。
7. 印出每個人要做一次的信任步驟，然後打開看板。

選項：
- `--check`：只列出每一項設定是最新、過期還是缺少，不改任何東西。
- `--no-push`：不推送 agent 設定檔的 commit（`team.md` 和狀態檔仍會照常直接寫到預設分支）。
- `--enable-discussions`：沒開 Discussions 時直接開，不詢問。
- `--no-board`：完成後不打開看板。
- `--json`：輸出 `{ "created": [路徑…], "discussions": "enabled" | "disabled-fallback-issues" | "unknown" }`，不打開看板。搭配 `--check` 時輸出 `[{ "item", "path", "state": "current" | "stale" | "missing", "note"? }]`。

### `tandem invite <帳號>`

邀請對方成為 repo 協作者（權限 push），印出可以傳給對方的分享文字（下載頁網址，repo 名稱放在 `#join=` 後面）。對方本來就有權限時也會印分享文字。

- `--json`：`{ "invited": "<帳號>", "status": "invited" | "already", "shareText": "…", "url": "…" }`
- 沒有權限邀請時，結束代碼 3。每個 repo 每 24 小時最多 50 個邀請；組織可能不允許外部協作者。

### `tandem join <owner/repo>`

被邀請的人用：用 API 接受邀請（不用收信）、clone、做一次和 init 一樣的設定（但不會去開 Discussions）、記成專案、打開看板。也接受 `https://github.com/owner/repo` 形式。

- `--dir <資料夾>`：下載到哪裡；預設是目前資料夾下的 `<repo 名稱>`，已有同名且不是空的資料夾就改用 `<名稱>-2` 等。資料夾已經是 clone 就直接用。
- `--no-board`：完成後不打開看板。
- `--json`：`{ "repo": "owner/name", "dir": "…" }`

## 開工和收工

### `tandem brief`

先同步，再印出上次之後跟你有關的變動（誰在等你、你在等誰、新決定、指派給你的任務、隊友狀態、紀錄問題），每類最多 5 項。讀 GitHub 超過 15 秒就跳過（討論和任務可能不是最新的）。印完記住「報告到這裡」。

- `--peek`：只看，不記住。
- `--json`：輸出完整內容：

```json
{
  "me": "theroyatlas",
  "repo": { "owner": "…", "name": "…" },
  "since": { "commit": "a1b2c3d…", "time": "2026-11-14T14:10:00.000Z" },
  "waitingOnMe": [{ "kind": "discussion", "title": "…", "url": "…", "from": "jielle2453", "to": "theroyatlas", "since": "…" }],
  "iAmWaitingOn": [],
  "newDecisions": [{ "id": "D-…", "title": "…", "deciders": ["jielle2453"], "strength": "preference", "mentionsMe": true, "path": "tandem/decisions/…", "url": "…" }],
  "assignedToMe": [{ "number": 12, "title": "…", "url": "…" }],
  "teammates": [{ "login": "jielle2453", "doing": "…", "blocked": "", "fyi": ["…"], "updated": "…" }],
  "problems": ["tandem/decisions/…：…"],
  "quiet": false
}
```

`kind` 是 `discussion`、`pr_review` 或 `blocked_issue`。`quiet` 為 true 代表沒有跟你有關的變動。

### `tandem status`

更新自己的狀態檔（只會寫自己的）。沒給的欄位保留原值。

- `--doing <文字>`、`--next <文字>`、`--notes <文字>`
- `--blocked <文字>`：空字串代表沒卡。
- `--fyi <文字>`：要大家知道的，可重複，最多 3 則；寫成 `文字=參照` 會把最後一個 `=` 後面當參照。有給就整串換掉。
- `--deliverable <標題=網址>`：成品，可重複，最多 5 個；有給就整串換掉。
- `--input <檔案|->`：JSON，欄位 `doing`、`next`、`blocked`、`notes`、`fyi: [{text, ref?}]`、`deliverables: [{title, url}]`。同時給旗標時，旗標優先。
- `--dry-run`：印出新的檔案內容，不寫入。
- `--json`：`{ "path", "content", "status", "problems", "write"? }`
- `--no-sync`：目前沒有作用（寫入一律馬上嘗試推送）。

## 紀錄

### `tandem decide`

新增一筆決定。寫入前跑和 `tandem check` 一樣的驗證，不通過就不寫，結束代碼 1。

建議用 JSON（agent 一律這樣用）：

```json
{
  "title": "第一版先做本機網頁",
  "slug": "local-web-first",
  "deciders": ["jielle2453"],
  "consulted": ["theroyatlas"],
  "strength": "preference",
  "source": "chat",
  "area": "架構",
  "quotes": [{ "by": "jielle2453", "text": "（使用者逐字說的話）", "source": "chat" }],
  "decision": "…",
  "why": "…",
  "optionsConsidered": "…",
  "scope": "…",
  "supersedes": []
}
```

- 必填：`title`、`decision`、`why`。`deciders` 沒給用自己；`strength` 沒給是 `preference`；`source` 沒給是 `chat`。
- `quotes` 每則可加 `relayedBy`（轉述的人）。`quotes` 是空的又沒給 `noQuoteBy` 時，自動記成「無原話，由 @自己 的 agent 整理。」
- `date` 選填，預設今天；`slug` 選填，預設從標題轉。編號自動產生。

不用 JSON 時的旗標（給了 `--input` 就不看這些）：`--title`、`--decision`、`--why`（三個必填）、`--strength`、`--source`、`--area`、`--slug`、`--quote <使用者的原話>`（記成自己說的）、`--supersedes <編號>`（可重複）。

- `--dry-run`：印出完整檔案內容給使用者確認，不寫入。
- `--json`：`{ "id", "path", "content", "problems", "write"?, "written": true|false }`
- `--no-sync`：目前沒有作用。

### `tandem ask <帳號> --title <標題> --body <內容>`

開一則等對方回答的問題：Q&A 分類的討論，內文第一行 `等：@帳號`，標籤 `tandem:question`。沒開 Discussions 時改開 issue。

- `--json`：`{ "kind": "discussion" | "issue", "number", "url" }`

可以先做、之後再改的事，直接記決定，不要開問題（減少噪音）。

### `tandem disagree --with <帳號> --title <標題> --body <自己的立場>`

開一則分歧討論（標籤 `tandem:disagreement`），內文是發起人自己的立場；對方用自己的帳號在討論串回覆，沒人能改寫別人的話。`--json` 格式同 `ask`。

### `tandem resolve <討論編號或網址>`

結束一則討論。

- `--decision <編號>`：先留一則「已定案，見決定 …」的留言，再關閉。
- `--reason <原因>`：`resolved`（預設）、`outdated`、`duplicate`。
- `--json`：`{ "closed": <編號>, "decision": "<編號>" | null }`

只能關閉 Discussions，不能關閉改用 issue 開的問題。

### `tandem task <標題>`

開一個 issue，加 `tandem:task` 標籤。

- `--assign <帳號>`：指派，可重複。
- `--body <內容>`
- `--json`：`{ "number", "url" }`

## 維護

### `tandem sync`

送出本機待送區裡的紀錄，再 fetch 遠端預設分支。不 commit、pull、rebase 或推送使用者自己的分支。看板、hook、brief 都會自動做，人通常不用手動執行。

- `--json`：`{ "result": "ok" | "nothing" | "conflict" | "offline", "committed", "pulled", "pushed", "message"? }`
- 有衝突時結束代碼 1。

### `tandem check`

檢查遠端預設分支上的所有決定和狀態（規則見資料模型）。有錯誤時結束代碼 1；只有警告時是 0。

- `--fix`：只修能自動修的（重複編號：保留一筆，其他換新編號）。
- `--quiet`：沒有問題時不印任何東西（pre-commit hook 用）。
- `--json`：`{ "problems": [{ "path", "severity": "error" | "warning", "code", "message", "fixable"? }], "fixed": ["舊路徑 -> 新路徑"] }`

### `tandem doctor`

檢查環境，每一項說明怎麼修：GitHub 登入（來源是環境變數、Tandem 登入或 gh）、專案和目前帳號、Discussions 是否開啟且有 Q&A 分類、每個 agent 設定檔是否最新、紀錄格式。最後提醒信任設定無法自動檢查（Claude Code 要信任工作區；Codex 要信任專案並在 `/hooks` 同意）。

- `--json`：`[{ "item", "ok": true|false, "note" }]`
- 有任何一項沒過，結束代碼 1。

### `tandem mcp`

給 agent 用的 MCP 伺服器（003），走標準輸入輸出。提供 `tandem_brief`、`tandem_decide`、`tandem_status`、`tandem_ask`、`tandem_disagree`、`tandem_task`、`tandem_decisions`、`tandem_check`，大多和同名指令效果一樣；`tandem_decisions` 是指令沒有的，用關鍵字或領域查已有的決定（含原話）；在 Tandem 裡啟動的 Claude 對話另外有內部用的 `approve`。`tandem init` 會把它登記到 `.mcp.json` 和 `.codex/config.toml`。

### `tandem hook <事件>`

給 agent hook 呼叫的入口，不是給人用的。從標準輸入讀 agent 傳來的 hook 資料，一律輸出 JSON（Codex 的 Stop hook 不接受純文字），出錯也不會擋住 agent。整體最多 12 秒。

- 事件：`session-start`（放入開工報告）、`stop`（有做事卻沒更新狀態時提醒一次）、`user-prompt`、`post-compact`（Codex 壓縮脈絡後重放開工報告）。
- `--agent <claude|codex>`：輸出照哪一家的格式，預設 `claude`。

## 其他

- `tandem --version`：印出版本（目前 0.2.1）。
- `tandem --help`、`tandem <指令> --help`：說明；參數錯誤時也會印出說明。
