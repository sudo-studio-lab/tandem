# 介面合約：`tandem` 命令列工具（001-core）

**格式**：照 spec-kit 的 contracts/（命令列工具的指令定義）。
**慣例**（參考 gh CLI 和 clig.dev）：
- 指令是「名詞」或「動詞」一個字，例如 `tandem brief`、`tandem decide`。
- 每個指令都支援 `--json`，輸出機器可讀的結果；預設輸出給人看的文字。agent 用 `--json`。
- 內容複雜時（原話含引號、中文、換行）用 `--input <檔案>` 或 `--input -`（從標準輸入讀 JSON），避免 Windows shell 的引號問題。
- 會寫入的指令都支援 `--dry-run`：只印出將要寫入的內容，不寫入。agent 用它做「回條」：先給使用者看，使用者說對再正式執行。
- 結束代碼：0 成功、1 錯誤、2 用法錯誤、3 需要人處理（例如需要網頁上的權限設定）。

## 開始和加入

### `tandem`（不帶參數）＝ `tandem board`

在本機啟動看板伺服器並用瀏覽器打開。第一次在 repo 裡執行時，自動先跑 `tandem init`。

### `tandem init`

在目前的 repo 開始使用 Tandem。可以重複執行（只會更新自己管理的部分）。

會做的事：
1. 建立 `tandem/decisions/`、`tandem/status/<自己>.md`、`tandem/team.md`（範例內容）。
2. 在 `AGENTS.md` **最上方**插入 Tandem 管理區塊（見 agent-integration.md）；沒有 AGENTS.md 就建立。
3. 確保 Claude Code 會讀到 AGENTS.md：沒有 CLAUDE.md 就建立一個只有 `@AGENTS.md` 的；有但沒引用就在最上方加一行（包在 Tandem 標記裡）。
4. 寫入兩家 agent 的開工和結束 hook、技能檔（見 agent-integration.md）。
5. 安裝本機 git pre-commit hook，提交前跑 `tandem check`。
6. 印出每個人只需要做一次的「信任」步驟。

選項：`--check`（只檢查哪些部分缺少或過期）、`--remove`（只移除 Tandem 自己加的部分）。
參考：Beads `bd init` / `bd setup`、Backlog.md `backlog init`。

### `tandem invite <github帳號>`

邀請對方成為 repo 協作者，印出分享連結。
- 輸出：`{ "invited": "theroyatlas", "link": "https://…" }`
- 沒有權限邀請時，結束代碼 3，告訴使用者請誰在網頁上處理。

### `tandem join <owner/repo>`

被邀請的人用：接受邀請、clone 到預設資料夾、初始化本機狀態、打開看板。分享連結最後會執行這個指令。

## 開工和收工

### `tandem brief`

印出跟目前使用者有關的變動，以及給 agent 的簡短工作說明。報告後記住報告到哪裡。

選項：
- `--peek`：只看，不更新「上次報告到哪」。
- `--hook-json`：輸出給 agent hook 用的 JSON（見 agent-integration.md），總長度控制在約 2,000 tokens 內（Codex 的上限約 2,500）。

`--json` 輸出：
```json
{
  "since": { "commit": "a1b2c3d", "time": "2026-11-14T22:10:00+08:00" },
  "waiting_on_me": [{ "kind": "discussion", "title": "…", "from": "jielle2453", "url": "…", "since": "…" }],
  "i_am_waiting_on": [{ "kind": "pr_review", "title": "…", "who": "theroyatlas", "url": "…" }],
  "new_decisions": [{ "id": "D-…", "title": "…", "deciders": ["…"], "mentions_me": true, "path": "…" }],
  "assigned_to_me": [{ "number": 12, "title": "…", "url": "…" }],
  "teammates": [{ "login": "…", "doing": "…", "blocked": "…", "fyi": ["…"], "updated": "…" }],
  "problems": ["tandem/decisions/D-…: 缺原話出處"]
}
```

### `tandem status`

覆寫自己的狀態檔並同步。
選項：`--doing`、`--next`、`--blocked`、`--fyi <文字>[=<參照>]`（可重複）、`--deliverable <標題>=<網址>`（可重複）、`--input`。
只會寫自己的檔；沒有給的欄位保留原值。

## 紀錄

### `tandem decide`

新增一筆決定並同步。

```json
{
  "title": "先做本機網頁",
  "deciders": ["jielle2453"],
  "strength": "preference",
  "source": "chat",
  "area": "架構",
  "quotes": [{ "by": "jielle2453", "text": "好 那你要開始寫spec嗎", "source": "chat" }],
  "decision": "…",
  "why": "…",
  "options_considered": "…",
  "scope": "…",
  "supersedes": []
}
```

- 自動產生 id 和檔名。
- 寫入前跑和 `tandem check` 一樣的驗證；不通過就不寫，回傳錯誤原因。
- `--dry-run` 印出完整檔案內容給使用者確認。

### `tandem ask <github帳號> --title <標題> --body <內容>`

開一則等對方回應的討論（`tandem:question`），回傳網址。

### `tandem disagree --title <標題> --with <github帳號> --body <自己的立場>`

開一則分歧討論（`tandem:disagreement`），內文是發起人自己的立場；對方用自己的帳號在討論串回覆。

### `tandem resolve <討論網址或編號> [--decision <id>]`

在討論串留一則連到決定的留言，然後關閉討論。

### `tandem task <標題> [--assign <github帳號>] [--body <內容>]`

開一個 issue（`tandem:task`）。

## 維護

### `tandem sync`

同步 `tandem/` 底下的紀錄：pull（rebase）→ 提交自己的變動 → push。看板和其他寫入指令會自動呼叫，人不需要手動執行。
只會自動提交 `tandem/` 底下的檔案；其他檔案的變動不碰。

### `tandem check [--fix]`

檢查所有紀錄（規則見 data-model.md）。`--fix` 只修能自動修的（例如撞號時改後來那筆的編號）。
參考：PEP `check-peps.py`、Backlog.md `backlog doctor`。

### `tandem doctor`

檢查環境：GitHub 登入、repo 權限、Discussions 是否開啟、兩家 agent 的 hook 是否被信任、管理區塊是否過期。每一項說明怎麼修。

### `tandem hook <事件>`

給 agent hook 呼叫的入口，不是給人用的。事件：`session-start`、`stop`、`user-prompt`、`post-compact`。一律輸出 JSON（Codex 的 Stop hook 不接受純文字）。
