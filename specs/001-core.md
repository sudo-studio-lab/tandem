# 001 Tandem 核心

> **這是紀錄，不是定案。** 這份描述 001 做了什麼、怎麼做、為什麼，以 0.2.1 的程式碼為準。
> 之後的兩個功能改了一些地方：**002 桌面版**換掉了同步方式和 GitHub 登入，看板變成多專案的桌面 app；**003 agent** 加了 `tandem mcp`、在 Tandem 裡跟自己的 agent 對話、房間。改過的地方會在段落裡標「（002 改）」「（003 加）」，並整理在〈跟原本計畫不一樣的地方〉。
> 資料格式見 [data-model.md](data-model.md)，指令見 [contracts/cli.md](contracts/cli.md)。

## 要解決的問題

兩個人各自跟自己的 AI agent 工作都很順，一起做卻常常在等：等對方做決定、等對方把想法寫成文件、文件傳過來才發現少了東西。之前試過寫一整套協作規則，結果太麻煩，沒人照做。

001 的目標：**邀請隊友就能開始；每個人照常跟自己的 agent 工作，決定和狀態由 agent 記下來；誰都能看到專案進展和每個人在做什麼。人不用學規則。**

## 做了什麼

- **開始和邀請**：在一個 GitHub repo 裡執行 `tandem init`，專案需要的檔案和給 agent 的指示自動建好，原本的 AGENTS.md、CLAUDE.md 內容不動。`tandem invite <帳號>` 邀請隊友並產生一段分享文字；對方用 `tandem join owner/repo`（或桌面版）就會自動接受邀請、下載專案、完成設定。
- **開工報告**：隊友打開 Claude Code 或 Codex 時，hook 會把「上次之後跟你有關的變動」放進 agent 的脈絡，agent 在第一個回覆用五行以內告訴使用者。沒有變動就不說；報告過的不重複。
- **記決定，連同原話**：使用者說出會影響別人的決定，agent 先用 `--dry-run` 產生紀錄給使用者看「我記成這樣，對嗎？」，確認後才寫入。紀錄裡有逐字原話、誰說的、在哪裡說的，以及強度（硬性、偏好、直覺、只限這次）。
- **問隊友、意見不同**：做不下去時用 `tandem ask` 開一則 GitHub 討論並 @ 對方，對方會收到 GitHub 通知；意見不同用 `tandem disagree`，雙方各自用自己的帳號寫立場。結束時 `tandem resolve` 關閉討論、連到產生的決定。
- **狀態**：每個人有一份只有自己的 agent 會改的狀態（在做什麼、接下來、卡在哪、要大家知道的、成品連結）。工作結束前 agent 更新它；有做事卻沒更新，Stop hook 會提醒一次。
- **派任務**：`tandem task` 開一個 GitHub issue 並指派。
- **看板**：`tandem` 在瀏覽器打開本機看板，顯示每個人的狀態、誰在等誰、開著的討論和任務、最近的決定、成品連結。（002 把它包成桌面 app。）
- **檢查**：`tandem check` 找出格式錯誤、缺原話的紀錄；`tandem doctor` 檢查登入、Discussions、agent 設定。

## 不在這次範圍

- 桌面 app、通知、`tandem://` 連結、不用終端機的登入：002。
- 在 Tandem 裡跟自己的 agent 對話、MCP 工具、房間（多人一起跟一個 agent 討論）：003。
- 派工給別人的 agent（本人看過才執行）、用團隊金鑰的「團隊大腦」、雲端網頁版：還沒做。
- 誰有權決定分歧：只記錄雙方立場和最後做決定的人，不強制規則。
- Tandem 不經手任何 AI 服務的登入或憑證；每個人用自己的 agent 和訂閱。

## 怎麼做的

### 一個核心，多個介面

所有邏輯在 `packages/core`，資料格式定義在 `packages/contracts`（只有定義，不讀寫）。介面都呼叫同一個核心：

| 介面 | 位置 | 誰用 |
|---|---|---|
| `tandem` 指令 | `apps/cli` | 人和 agent |
| agent hook | `tandem hook <事件>` | Claude Code、Codex 自動呼叫 |
| 本機伺服器加看板 | `apps/cli/src/server.ts` 加 `apps/web` | 瀏覽器；002 起桌面 app 用 `tandem serve` |
| MCP 工具 | `tandem mcp`（003 加） | agent |

### 資料放在哪

- **決定**：repo 的 `tandem/decisions/`，一筆一檔。
- **狀態**：`tandem/status/<帳號>.md`，一人一檔。
- **團隊習慣**：`tandem/team.md`，白話。
- **問題、分歧**：GitHub Discussions（沒開時改用 Issues）。**任務**：GitHub Issues。**成品**：PR、網址、檔案。
- **本機狀態**（上次報告到哪、快取）：`.git/tandem/`，不進 repo。

紀錄的「正本」是 **遠端預設分支**（通常是 `origin/main`）上的 `tandem/`。（002 改：001 原本讀寫工作目錄裡的 `tandem/`。）

### 主要流程

**init**：建立 `tandem/team.md`（範本）和自己的狀態檔；在 AGENTS.md 最上方加管理區塊，CLAUDE.md 加 `@AGENTS.md`；寫入兩家的 hook 設定和技能檔（003 起也登記 MCP）；安裝 git pre-commit hook；檢查 Discussions，沒開就問使用者要不要開，不同意就改用 Issues；建立三個標籤。agent 設定檔在目前分支上單獨 commit 並推送，但如果這個分支上還有使用者自己沒推的 commit，就先不推，免得把別人的程式碼一起推出去。最後提醒每個人要在 agent 裡做一次「信任這個專案」。

**invite / join**：invite 呼叫 GitHub「加協作者」API（權限 push），印出分享文字。join 用 GitHub API 幫被邀請的人接受邀請，不用去收信；再 clone、做一次 init 的設定（不會去開 Discussions），打開看板。

**brief**：先同步，再從遠端預設分支讀紀錄、從 GitHub 讀討論、PR、issue（逾時 15 秒就跳過 GitHub），算出「誰在等我、我在等誰、新決定、指派給我的任務、隊友狀態變化、紀錄問題」。比較基準是上次報告時遠端預設分支的 commit；第一次沒有基準，就看最近 7 天。報告完記住新的基準（`--peek` 不記）。

**decide**：組出決定檔、產生編號、跑完整驗證；有錯就不寫。`--dry-run` 只印出內容，當作給使用者確認的「回條」。

**ask / disagree / resolve / task**：ask 和 disagree 開一則 Q&A 分類的討論，內文第一行寫 `等：@對方`，加上標籤；resolve 可以先留言連到決定，再關閉討論；task 開一個帶 `tandem:task` 標籤的 issue。

**status**：讀自己現在的狀態檔，只覆蓋這次有給的欄位，整份重寫。只會寫自己的檔。

**sync**（002 改）：寫入時，紀錄先放進本機的待送區（outbox），在檔案鎖裡 fetch 遠端預設分支、用暫時的 index 疊上要寫的檔案、產生 commit、直接推到預設分支。別人先推了就重做（最多 3 次）；離線就留在待送區，下次再送。全程不碰使用者的工作目錄和分支。`tandem sync` 只是「送出待送區，再 fetch 一次」。

**check / doctor**：check 讀遠端預設分支上的所有決定和狀態，照規則檢查；`--fix` 只修撞號。doctor 依序檢查 GitHub 登入、專案、Discussions、每個 agent 設定檔是否最新、紀錄格式，並提醒信任設定無法自動檢查。

**hook**：`session-start` 同步後算 brief，輸出給 agent 的開工報告和工作方式；同時記下這個 session 開始時的 commit 和工作目錄指紋。`stop` 判斷這次 session 有沒有改到 `tandem/` 以外的東西、自己的狀態有沒有在這段時間更新，有做事卻沒更新就要求 agent 先更新（每個 session 只提醒一次）。脈絡被壓縮後：Claude Code 的 SessionStart 本來就會在壓縮時再跑一次；Codex 則用 `post-compact` 記一個旗標，下一次 `user-prompt` 再放一次開工報告。hook 整體限 12 秒，出任何錯都輸出合法 JSON、不擋 agent。

## 技術選擇和原因

### 紀錄編號：日期加 4 碼亂數
- **選了**：`D-YYYYMMDD-xxxx`（4 碼小寫英數），檔名是編號加英文 slug。
- **為什麼**：多人同時新增不用協調。同一天才可能撞號，約 168 萬種組合，一天 30 筆撞號機率約萬分之三；真的撞了 `tandem check --fix` 會改號。
- **沒選**：流水號——兩人同時新增一定撞號；用 PR 編號——我們的紀錄不走 PR。

### 決定寫了就不改，「已取代」讀的時候算
- **選了**：新決定寫 `supersedes`，舊檔完全不動；檔案裡沒有 `status` 欄位。
- **為什麼**：只新增檔案，兩個人同時推翻同一個決定也不會有文字衝突；歷史一直保留。
- **沒選**：新舊兩邊都改、只在舊檔寫 `superseded_by`——都要改別人的檔。

### 定案出處放 frontmatter
- **選了**：`source` 必填：定案那則發言的網址，在自己 agent 對話裡定的寫 `chat`。
- **為什麼**：放在 frontmatter 才能自動檢查。

### 討論在討論串，定案才寫檔
- **選了**：還沒定案的事放 GitHub Discussions；定案才寫決定檔；被否決的做法寫進決定的「考慮過的其他做法」。
- **沒選**：把被拒絕的提案也留在 repo——對小團隊太重。

### 不維護索引檔，讀的時候算
- **選了**：看板和 brief 每次從檔案和 GitHub 現算。
- **為什麼**：大家都會改的索引檔是最容易衝突的地方。

### 驗證在寫入時和提交前執行
- **選了**：`tandem decide` 寫入前跑完整驗證；`tandem init` 在 git pre-commit 加一段 `tandem check --quiet`；`--fix` 處理撞號。
- **為什麼**：紀錄直接進預設分支，雲端 CI 只能事後發現，本機檢查才是真正的關卡。

### 狀態一人一檔
- **選了**：`tandem/status/<帳號>.md`，只有本人寫；「在等誰」不寫在狀態裡，從討論、PR、issue 算。
- **為什麼**：沒人改別人的檔，就不會衝突；等待關係只有一個來源，不會兩邊不一致。
- **沒選**：另設協作資料庫——為大規模設計，2–5 人用不到。

### 說明放在指令裡，repo 只放一小段
- **選了**：AGENTS.md 只放約 10 行的管理區塊；詳細做法由 `tandem brief`（開工報告）和技能檔提供。
- **為什麼**：流程改了只要更新工具，不用改每個人的 repo。

### 管理區塊放 AGENTS.md 最上方，CLAUDE.md 用 `@AGENTS.md`
- **選了**：`<!-- BEGIN TANDEM v:1 hash:… -->` … `<!-- END TANDEM -->`；沒有 CLAUDE.md 就建一個只有 `@AGENTS.md` 的，有但沒引用就在最上方加一段（也包在標記裡）。
- **為什麼**：Codex 合併 AGENTS.md 有大小上限（預設 32 KiB），放最上方不會被截掉；Claude Code 有 CLAUDE.md 時不會自己讀 AGENTS.md，官方建議用 `@AGENTS.md` 引用；HTML 註解不佔模型脈絡；標記帶版本和雜湊，能判斷缺少、過期或最新，也能只換掉自己那段。

### 兩家都用 hook 開工和收工
- **選了**：兩家的 SessionStart 跑 `tandem hook session-start`；Stop 只在有做事卻沒更新狀態時提醒；Codex 另外用 PostCompact 加 UserPromptSubmit 在壓縮後重放開工報告。
- **為什麼**：兩家的 hook 幾乎一樣（SessionStart 能放文字進脈絡、Stop 能要求繼續）。Codex 的 SessionStart 放入內容上限約 2,500 tokens，所以開工報告寫得很短；Codex 的 Stop 只收 JSON，所以 hook 一律輸出 JSON。
- **沒選**：只靠 AGENTS.md 的文字——是要求不是保證，只當備援。

### 同一份技能檔寫到兩家的資料夾
- **選了**：標準 `SKILL.md` 格式，寫到 `.claude/skills/` 和 `.agents/skills/`，目前有 `tandem-decision`、`tandem-status`、`tandem-ask` 三個。
- **為什麼**：Agent Skills 是開放格式，Claude Code 讀前者、Codex 讀後者。

### 程式架構和套件
- **選了**：TypeScript、Node.js 22 以上；npm workspaces（不用另外裝 pnpm）；zod 定義格式；`yaml` 解析 frontmatter；commander 做指令；Hono 做本機伺服器、Server-Sent Events 推更新；Vite 加 React 做看板；vitest 測試，GitHub 呼叫用假的 fetch。
- **為什麼**：既有工具鏈使用 npm 生態系，Windows、macOS 都能跑；一份格式定義同時用在驗證、指令輸出和看板。
- **沒選**：每個介面各寫一份邏輯——行為會越來越不一致。

### 本機看板只聽 127.0.0.1，加一次性通行碼
- **選了**：伺服器只綁 `127.0.0.1`（預設埠 4318，被占用就往後找）；打開瀏覽器的網址帶一次性通行碼，之後換成 cookie。
- **為什麼**：任何網頁都能連 localhost，只綁本機還不夠。

### GitHub 登入
- **選了**：權杖讀取順序：環境變數（`TANDEM_TOKEN`、`GH_TOKEN`、`GITHUB_TOKEN`）→ 作業系統的認證管理員 → `gh auth token`。001 實際只靠 `gh`；002 加上 Tandem 自己的 OAuth App 裝置碼登入（顯示一組代碼、在瀏覽器確認），權限 `repo`、`read:org`，權杖存進認證管理員（`@napi-rs/keyring`）。
- **為什麼**：當時兩人都已登入 `gh`，不用任何設定；但沒裝 `gh` 的人用不了，所以 002 補上裝置碼流程。裝置碼流程不需要 client secret，適合發出去的工具。git 推拉時權杖只放在子行程的環境變數，不寫進 `.git/config` 或指令列。
- **沒選**：GitHub App——權限能切細，但每個 repo 擁有者都要先安裝，接受邀請也需要很重的權限，破壞「輸入帳號、傳連結」的流程；keytar——已停止維護。

### 邀請和加入
- **選了**：invite 呼叫「加協作者」API；join 列出自己的邀請、找到這個 repo 就接受（`PATCH /user/repository_invitations/{id}`），再 clone。
- **為什麼**：GitHub 允許被邀請的人用 API 自己接受，不用收信，也不用我們架伺服器。
- **限制**：每個 repo 每 24 小時最多 50 個邀請；組織 repo 邀請的是外部協作者，組織可能禁止。
- **分享連結**：001 原本是「repo 網址加一行 join 指令」；002 改成公開下載頁的網址，repo 名稱放在 `#join=` 後面（不會送到伺服器）。

### 同步：只動紀錄，衝突就停
- **選了（001）**：所有 git 操作排成一條隊伍；`tandem/` 有變動就等幾秒再提交、`pull --rebase --autostash`、推送；衝突時停止、在看板顯示，絕不自動解決或強制推送。
- **選了（002 改，現況）**：紀錄直接用 git 底層指令寫到遠端預設分支（見〈主要流程〉的 sync）。
- **為什麼改**：001 的做法會順便推送使用者分支上的程式碼 commit；在功能分支上記的決定，要等合併後別人才看得到。改成直接寫預設分支後，兩個問題都沒了，而且紀錄仍然能在 GitHub 網頁上直接看到。
- **還成立的部分**：一筆一檔、一人一檔，讓衝突幾乎不會發生；同名檔案真的撞上時，那筆寫入被放到 `.git/tandem/conflicts/`，不會蓋掉別人的。

### 輪詢 GitHub，不用 webhook
- **選了**：本機伺服器每 3 分鐘同步一次並重讀 GitHub；REST 請求帶 ETag（沒變動回 304，不算額度），快取存在本機狀態；寫入請求之間至少隔 1 秒；遇到額度用完會等待重試。
- **為什麼**：沒有伺服器就收不到 webhook；每人每小時 5,000 次額度，5 人團隊遠用不完。
- **跟原計畫不同**：原本規劃看板開著時每 60 秒 fetch、Discussions 每 2–5 分鐘、看板隱藏時暫停，現在統一 3 分鐘。

### Discussions 用內建 Q&A 分類，開之前先問
- **選了**：問題和分歧放在內建的 Q&A 分類（可以標記答案），用 `tandem:question`、`tandem:disagreement` 標籤區分；沒開 Discussions 時，`tandem init` 先問，同意才用 API 開（需要管理權限）；不開就改用 Issues。
- **為什麼**：GitHub 沒有建立討論分類的 API，用內建分類才不用人手動設定；開 Discussions 是 repo 設定，必須先問。免費方案的私人 repo 也能開（已實測）。

### 桌面版（002 才做）
當時先記下的方向：Electron 執行同一份伺服器程式、per-user 安裝檔、從 GitHub Releases 自動更新、`tandem://` 連結、Windows 程式碼簽章的費用和地區限制。細節見 002。

## 跟原本計畫不一樣的地方

| 原本計畫 | 現在 |
|---|---|
| 001 借用 `gh` 登入，之後再做 OAuth App | 002 做了裝置碼登入，但只在本機伺服器／桌面 app 裡；`tandem` 指令沒有 login 子指令，靠環境變數、認證管理員裡的權杖或 `gh` |
| 同步：在工作目錄 commit `tandem/`、pull --rebase、push；監看資料夾、5–10 秒後提交 | 002 改成直接寫遠端預設分支加本機待送區；伺服器每 3 分鐘同步。舊的資料夾監看程式還在 core 裡，但沒有被用到 |
| 用 Octokit 呼叫 GitHub | 自己用 fetch 寫了 REST 和 GraphQL 用戶端（含 ETag、額度重試） |
| 用 gray-matter 解析 frontmatter | 用 `yaml` |
| research 寫 pnpm monorepo；plan 寫 npm workspaces | npm workspaces |
| `packages/client-runtime`、`apps/mcp` | 沒有另外建；MCP 是 `tandem mcp` 子指令（003） |
| `tandem`（不帶參數）第一次在 repo 裡執行會先跑 init | 不會自動 init；只是把這個 repo 記成專案、打開看板 |
| `tandem init --remove` 移除 Tandem 加的部分 | 核心有移除功能，但指令沒有提供這個選項 |
| `tandem brief --hook-json` 給 hook 用 | 改成獨立的 `tandem hook <事件> --agent claude\|codex` |
| `brief --json` 欄位用底線命名（`waiting_on_me`） | 用駝峰命名（`waitingOnMe`），並多了 `me`、`repo`、`quiet` |
| init 會建立 `tandem/decisions/` 資料夾 | git 不存空資料夾；第一筆決定寫入時才出現 |
| doctor 檢查 repo 權限和 hook 是否被信任 | 不檢查權限；信任設定無法自動偵測，只提醒 |
| 分享連結：repo 網址加 `npx tandem join` | 公開下載頁加 `#join=owner/repo`（002） |
| 遷移舊的人工紀錄到 `tandem/` | 做過一次，遷移程式碼之後移除了 |
| 新增：— | `tandem resolve --reason`、`decide` 不用 JSON 的簡單旗標、`status --notes`／`--dry-run`、`tandem serve`（002）、`tandem mcp`（003） |

## 已知的限制

- **改用 Issues 的問題不算進「誰在等誰」**：等待關係只從 Discussions、PR 審查和 issue 依賴算；`tandem resolve` 也只能關閉 Discussions。
- **`team.md` 沒有自動被讀**：init 會建立範本，但開工報告和管理區塊都沒有引用它，agent 要自己去打開才看得到。
- **pre-commit 檢查的不是這次要提交的內容**：它檢查遠端預設分支上的紀錄（加上本機待送區），而且需要 GitHub 登入；只要裝了 `tandem`，紀錄有錯或沒登入都會擋下使用者自己的程式碼提交。
- **`decide`、`status` 的 `--no-sync` 沒有作用**：寫入一律馬上嘗試推送，失敗才留在待送區。
- **同名衝突沒有處理工具**：被放到 `.git/tandem/conflicts/` 的寫入，目前只能手動處理（編號含亂數，實際上幾乎不會發生）。
- **預設分支有保護規則時推不上去**：紀錄會一直留在待送區；免費的私人 repo 不能設保護規則，所以目前沒遇到。
- **讀取量有上限**：Discussions 最多讀最近更新的 200 則（每則前 50 則留言），issue 依賴只看最近更新的 100 個開著的 issue。目標是 2–5 人的團隊。
- **brief 判斷「跟我有關」很粗**：新決定只排除「只有我自己決定的」；提到我＝我在 `consulted`、原話是我說的、或內文有 `@我`。細的判斷交給 agent。
- **信任設定只能靠人**：Claude Code 要信任工作區，Codex 要信任專案並在 `/hooks` 同意；沒做的話 hook 不會跑，只剩 AGENTS.md 的文字提醒。
- **開工報告受時間限制**：hook 裡同步和讀 GitHub 各最多 6 秒，逾時就用手上的資料，討論和任務可能不是最新的（有其他變動時報告裡會加註）。
