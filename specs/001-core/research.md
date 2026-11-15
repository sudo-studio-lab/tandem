# 研究紀錄（001-core）

**格式**：照 spec-kit 的 research.md：每個技術選擇寫「決定／理由／考慮過的其他做法」，並附參考來源（D-20261115-3d9）。
**研究日期**：2026-11-15。來源都是原始文件或原始碼；標「未確認」的實作時要驗證。

## R1. 紀錄編號：日期加 4 碼亂數

- **決定**：`D-YYYYMMDD-xxxx`（4 碼 base36），檔名是編號加英文 slug。
- **理由**：多人同時新增不需要協調。log4brains 明確寫到放棄流水號，因為「兩個開發者各自新增 ADR 時，git merge 會出問題」。Beads 用雜湊編號，宣稱「零衝突」，並用生日問題計算長度。
- **其他做法**：流水號（adr-tools、MADR、PEP、Backlog.md）——兩人同時新增一定撞號，Backlog.md 還得做 `doctor --fix` 補救；用 PR 編號（Rust RFC）——我們的紀錄不走 PR，不適用。
- **來源**：[log4brains 的決定](https://github.com/thomvaill/log4brains/blob/develop/docs/adr/20201016-use-the-adr-slug-as-its-unique-id.md)、[Beads 雜湊編號](https://github.com/gastownhall/beads/blob/main/docs/core-concepts/hash-ids.md)、[adr-tools 取號方式](https://github.com/npryce/adr-tools/blob/master/src/adr-new)

## R2. 決定寫了就不改，「已取代」讀的時候算

- **決定**：新決定寫 `supersedes`，舊檔不動；拿掉 `status` 欄位。
- **理由**：log4brains「ADR 不可變，只有狀態能改」、PEP「定案後是歷史文件」。只改新檔，兩個人同時推翻也不會有文字衝突。
- **其他做法**：adr-tools 和 PEP 兩邊都改（新檔寫取代誰、舊檔寫被誰取代）——要改別人的檔，會衝突；Backlog.md 只在舊檔寫 `superseded_by`——同樣要改舊檔。
- **來源**：[log4brains](https://github.com/thomvaill/log4brains)、[PEP 1](https://github.com/python/peps/blob/main/peps/pep-0001.rst)

## R3. 定案出處放 frontmatter

- **決定**：`source` 必填，是定案那則發言的網址（自己 agent 對話中定的寫 `chat`）。
- **理由**：PEP 的 Accept／Reject 必須有 `Resolution:` 連到做出決定的那則發言；放在 frontmatter 才能自動檢查。
- **來源**：[PEP 1](https://github.com/python/peps/blob/main/peps/pep-0001.rst)

## R4. 討論在討論串，定案才寫檔

- **決定**：還沒定案的事放 GitHub Discussions；定案才寫決定檔；被否決的做法寫在決定的「考慮過的其他做法」。
- **理由**：Rust RFC 的討論都在 PR 討論串，被拒絕的提案不進 repo；MADR 有「Considered Options」區塊。
- **其他做法**：PEP 把被拒絕的提案也留在 repo——對小團隊太重。
- **來源**：[Rust RFC 流程](https://github.com/rust-lang/rfcs/blob/master/README.md)、[MADR 範本](https://github.com/adr/madr/blob/develop/template/adr-template.md)

## R5. 不維護索引檔，讀的時候算

- **決定**：看板和 brief 每次從檔案和 GitHub 算。
- **理由**：PEP 0 在建置時產生、adr-tools 的目錄是臨時印出、Backlog.md 的看板直接讀檔；Changesets 的原則是「彙總檔只有機器人寫」。大家都改的索引檔是最容易衝突的地方。
- **來源**：[Changesets 自動化](https://github.com/changesets/changesets/blob/maintenance/v2/docs/automating-changesets.md)、[adr-tools 目錄](https://github.com/npryce/adr-tools/blob/master/src/_adr_generate_toc)

## R6. 驗證器在提交前和 agent 寫入時執行

- **決定**：`tandem check`：寫入指令內建、本機 pre-commit 也跑；`--fix` 處理撞號。
- **理由**：PEP 用 pre-commit 跑 `check-peps.py` 檢查必填欄位和狀態值；Backlog.md 的 `doctor` 找出重複編號。我們直接推 main，雲端 CI 只能事後發現，所以本機檢查才是真正的關卡。
- **來源**：[check-peps.py](https://github.com/python/peps/blob/main/check-peps.py)、[Backlog.md CLI 說明](https://github.com/MrLesk/Backlog.md/blob/main/CLI-INSTRUCTIONS.md)

## R7. 一人一檔的狀態

- **決定**：維持 `tandem/status/<login>.md`，只有本人寫。
- **理由**：Changesets 每個人一個檔、沒人改別人的檔，所以從不衝突。不用 Beads 的 Dolt 資料庫：那是為大規模設計的，2–5 人用不到。
- **來源**：[Changesets 說明](https://github.com/changesets/changesets/blob/maintenance/v2/docs/detailed-explanation.md)、[Beads 架構](https://github.com/gastownhall/beads/blob/main/docs/architecture/index.md)

## R8. 命令列工具是唯一的說明來源，repo 裡只放一小段指引

- **決定**：`tandem brief` 印出詳細做法；AGENTS.md 只放 10–15 行的管理區塊。
- **理由**：Beads 的 `bd prime`、Backlog.md 的 `backlog instructions` 都這樣做；流程改了不用改每個人的 repo。
- **來源**：[Beads 設定](https://github.com/gastownhall/beads/blob/main/docs/getting-started/ide-setup.md)、[Backlog.md](https://github.com/MrLesk/Backlog.md)

## R9. 管理區塊插在 AGENTS.md 最上方，帶版本標記；CLAUDE.md 用 `@AGENTS.md`

- **決定**：`<!-- BEGIN TANDEM v:1 hash:… -->` … `<!-- END TANDEM -->`；CLAUDE.md 最上方引用 AGENTS.md。
- **理由**：
  - Codex 合併 AGENTS.md 的上限預設 32 KiB，超過的部分會被丟掉，放最上方比較安全。
  - Claude Code 只在沒有任何 CLAUDE.md 時才自己讀 AGENTS.md；Anthropic 文件建議用 `@AGENTS.md` 引用。
  - Claude Code 會在給模型前拿掉 HTML 註解，標記不佔脈絡。
  - Beads 的標記帶版本和雜湊，能判斷缺少／過期／最新，也能只移除自己的部分。
- **來源**：[Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Claude Code 記憶與 AGENTS.md](https://code.claude.com/docs/en/memory#agents-md)、[Beads 設定](https://github.com/gastownhall/beads/blob/main/docs/getting-started/ide-setup.md)

## R10. 兩家都用 hook 開工和收工

- **決定**：兩家的 `SessionStart` 執行 `tandem hook session-start`；兩家的 `Stop` 只在有變動卻沒更新狀態時提醒；Codex 另外處理壓縮後重新放入。
- **理由**：兩家都有幾乎一樣的 hook（SessionStart 可以把文字放進脈絡、Stop 可以要求繼續）。Beads 已經在兩家都這樣用。Codex 的 SessionStart 放入的內容上限約 2,500 tokens；Codex 的 Stop hook 只接受 JSON。
- **其他做法**：只靠 AGENTS.md 的文字（Backlog.md）——是強烈要求，不是保證，所以只當備援。
- **來源**：[Claude Code hooks](https://code.claude.com/docs/en/hooks#sessionstart)、[Codex hooks](https://learn.chatgpt.com/docs/hooks)、[Beads 的 Codex 整合](https://github.com/gastownhall/beads/blob/main/docs/integrations/codex.md)

## R11. 同一份技能檔寫到兩家的資料夾

- **決定**：標準格式 `SKILL.md`，寫到 `.claude/skills/` 和 `.agents/skills/`。
- **理由**：Agent Skills 是開放標準；Claude Code 讀 `.claude/skills/`、Codex 讀 `.agents/skills/`。spec-kit 就是這樣支援兩家。
- **來源**：[Agent Skills 規格](https://agentskills.io/specification)、[Claude Code skills](https://code.claude.com/docs/en/skills)、[Codex skills](https://learn.chatgpt.com/docs/build-skills)

## R12. 一個核心、多個介面的程式架構

- **決定**：pnpm monorepo：`contracts`（資料格式定義）、`core`（所有邏輯）、`client-runtime`（看板狀態和重新連線）、`apps/cli`（發布到 npm，也負責提供看板網頁）、`apps/web`（看板介面）；之後加 `apps/desktop`、`apps/mcp`。
- **理由**：T3 Code 就是這樣分：「git 和專案檔案屬於伺服器；客戶端只提供介面」，`npx t3` 的套件把網頁打包進去一起提供。Backlog.md 也是一個核心同時給命令列、終端介面、網頁、MCP 用。
- **其他做法**：每個介面各寫一份邏輯——行為會越來越不一致。
- **來源**：[T3 Code 架構](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md)、[T3 Code 打包網頁](https://github.com/pingdotgg/t3code/blob/main/apps/server/scripts/cli.ts)、[Backlog.md](https://github.com/MrLesk/Backlog.md)

## R13. 本機看板只聽 127.0.0.1，每次啟動用隨機通行碼

- **決定**：伺服器只綁 `127.0.0.1`；打開瀏覽器的網址帶一次性通行碼，之後換成 cookie。
- **理由**：Backlog.md 的看板只聽 `127.0.0.1`；但任何網頁都能連 localhost，所以參考 T3 Code 的環境認證做簡化版。
- **來源**：[Backlog.md](https://github.com/MrLesk/Backlog.md)、[T3 Code 環境認證](https://github.com/pingdotgg/t3code/blob/main/docs/internals/environment-auth.md)

## R14. GitHub 登入：自己的 OAuth App（裝置碼流程），`gh` 的登入當備援

- **決定**：註冊一個 Tandem 的 OAuth App；命令列用裝置碼流程（顯示一組代碼、在瀏覽器確認），權限 `repo`、`read:org`；權杖存作業系統的鑰匙圈。順序：環境變數 `TANDEM_TOKEN` → Tandem 自己的權杖 → `gh auth token`。
- **理由**：
  - gh CLI 就是用裝置碼流程；裝置碼流程不需要 client secret，適合發布出去的工具。
  - `repo` 權限涵蓋私人 repo 的 Discussions、Issues、接受邀請、git 推拉。
  - 權杖用 `@napi-rs/keyring` 存（T3 Code 在用；GitHub Desktop 用的 keytar 已經停止維護）。
- **其他做法**：
  - GitHub App：權限可以切得很細，但每個 repo 的擁有者都要先安裝它，而且接受邀請需要很重的管理權限，破壞「輸入帳號邀請、傳連結」的流程。之後做雲端版時再考慮。
  - 只用 `gh` 的登入：不用註冊 App，但沒裝 gh 的人用不了，而且權杖不在我們控制之下。所以只當備援。
- **來源**：[GitHub OAuth App 授權](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[gh 登入流程](https://github.com/cli/cli/blob/trunk/internal/authflow/flow.go)、[GitHub App 使用者權杖](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)

## R15. 邀請和加入

- **決定**：`tandem invite` 呼叫「加協作者」API；被邀請的人登入後，`tandem join` 列出自己的邀請、找到這個 repo、接受、clone、打開看板。
- **理由**：GitHub 的 API 支援被邀請的人自己接受邀請（`PATCH /user/repository_invitations/{id}`），所以不用去收信，也不用我們架伺服器。
- **限制**：一個 repo 每 24 小時最多 50 個邀請；組織的 repo 邀請的是「外部協作者」，組織可能禁止；權限選項只在組織 repo 有效。
- **分享連結**：001 先用「repo 網址加上一行 `npx tandem join owner/repo`」；桌面版（002）再加 `tandem://join` 連結和一個靜態的說明頁。
- **來源**：[協作者 API](https://docs.github.com/en/rest/collaborators/collaborators)、[邀請 API](https://docs.github.com/en/rest/collaborators/invitations)

## R16. 背景同步：一條排隊、只提交 tandem/、衝突就停

- **決定**：所有 git 操作排成一條隊伍；`tandem/` 有變動時等 5–10 秒再提交，然後 `pull --rebase --autostash`、push；定時抓取。衝突時停止自動同步、在看板顯示「需要處理」，絕不自動解決、絕不強制推送。
- **理由**：Obsidian Git（約 1.2 萬星）的做法：排隊執行、先拉再推、衝突時停止自動提交並讓人處理。我們的資料設計（一人一檔、一筆一檔）讓衝突幾乎不會發生。
- **來源**：[Obsidian Git](https://github.com/Vinzent03/obsidian-git)

## R17. 輪詢 GitHub，不用 webhook

- **決定**：看板開著時每 60 秒 `git fetch`、背景每 5 分鐘；Issues 和 PR 用 ETag 條件請求（沒變動回 304，不計入額度）；Discussions 每 2–5 分鐘一次合併查詢；使用者剛操作完立即更新；看板隱藏時暫停。
- **理由**：沒有伺服器就收不到 webhook。GitHub 每人每小時 5,000 次額度，5 人團隊用量遠低於此。
- **來源**：[REST API 最佳做法](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)、[速率限制](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

## R18. Discussions 用內建 Q&A 分類，開啟前先問

- **決定**：用 GitHub 內建的 Q&A 分類加標籤區分問題和分歧。repo 沒開 Discussions 時，`tandem init` 先問使用者，同意才用 API 開啟（需要管理權限）；不能開就暫時改用 Issues。
- **理由**：GitHub 沒有建立討論分類的 API，用內建分類才不用人手動設定；Q&A 分類可以標記答案。開 Discussions 是 repo 設定，必須先問。
- **來源**：[Discussions GraphQL](https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions)

## R19. 桌面版（002 才做，先記錄）

- electron-builder 加 per-user NSIS 安裝檔（不需要系統管理員權限）、electron-updater 從 GitHub Releases 更新、更新時機設成「下次啟動時」（關機時更新可能損壞安裝）。
- 桌面版直接用 Electron 本身執行同一份伺服器程式（T3 Code 的做法）。
- `tandem://` 連結：Windows 用單一實例鎖加 `second-instance` 事件，macOS 用 `open-url`。
- Windows 簽章：Azure Artifact Signing 約每月 10 美元，但**個人只限美國和加拿大**；台灣的個人要改用 OV 憑證（每年約 300–500 美元），或以公司名義申請。這要在 002 之前決定。
- **來源**：[Electron 深層連結](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)、[electron-builder 自動更新](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)、[Windows 簽章](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview)

## 未確認（實作時驗證）

- ~~免費方案的私人 repo 能不能開 Discussions~~：可以。2026-11-15 用 `PATCH /repos/{o}/{r}`（`has_discussions=true`）開啟 sudo-studio-lab/tandem 成功，內建分類 Announcements、General、Ideas、Polls、Q&A（可標記答案）、Show and tell。
- Codex 在非互動模式下會不會執行 hook；支援 hook 放入脈絡的最低版本。
- GraphQL 支不支援 ETag。
- `git fetch` 算不算進 REST API 額度。
