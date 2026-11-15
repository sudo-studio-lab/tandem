# 實作計畫：Tandem 核心（001-core）

**格式**：照 spec-kit 的 plan.md。
**相關文件**：[spec.md](spec.md)（做什麼）、[research.md](research.md)（每個技術選擇的理由和來源）、[data-model.md](data-model.md)（資料格式）、[contracts/](contracts/)（指令和 agent 整合）、[quickstart.md](quickstart.md)（驗收測試）

## 摘要

做一個 `tandem` 命令列工具和一個本機網頁看板，共用同一個 TypeScript 核心（參考 T3 Code、Backlog.md）。資料存在專案的 GitHub repo（`tandem/` 資料夾）和這個 repo 的 Discussions、Issues、PR。兩家 agent 透過 AGENTS.md 管理區塊、hook、技能檔使用同一套指令（參考 Beads、spec-kit）。不架伺服器、不經手任何 AI 服務的登入。

## 技術背景

| 項目 | 選擇 | 理由 |
|---|---|---|
| 語言 | TypeScript，Node.js 22 以上 | Claude Code、Codex、T3 Code、Backlog.md 都在 npm 生態系；Windows、macOS 都能跑 |
| 套件管理 | npm workspaces | 不用另外裝 pnpm 或 bun，貢獻的人少一個安裝步驟（D-20261115-0e4） |
| 資料格式定義 | zod | 同一份定義用在驗證、命令列輸出、看板（參考 T3 Code 的 contracts 套件只放格式定義） |
| Markdown 和 frontmatter | gray-matter | 最常用的 frontmatter 解析器 |
| git | 呼叫系統的 git（一條排隊） | 使用者都有 git（D-20261115-e19）；桌面版再考慮內建 git（GitHub Desktop 用 dugite） |
| GitHub | Octokit（REST + GraphQL） | GitHub 官方的 JavaScript 用戶端 |
| 登入 | 最終：自己的 OAuth App，裝置碼流程，`gh` 登入當備援（research R14）。001 先只借用 `gh` 的登入（D-20261115-w7m2） | 你們兩個都已經登入 gh，不用任何設定 |
| 權杖儲存 | @napi-rs/keyring | T3 Code 在用；keytar 已停止維護 |
| 本機伺服器 | Hono，只聽 127.0.0.1，Server-Sent Events 推送更新 | 輕量、跨平台；推送讓看板即時更新（Backlog.md 用 WebSocket，SSE 更簡單且單向就夠） |
| 看板介面 | Vite + React | 之後包成桌面 app 不用重寫（D-20261115-8a2） |
| 測試 | vitest；用暫存 git repo 做整合測試；GitHub 呼叫用錄好的回應 | — |
| 目標平台 | Windows 11、macOS | FR-019 |
| 規模 | 一個專案 2–5 人、數百筆決定 | D-20261115-a3f |

**命名**：指令叫 `tandem`。npm 上 `tandem` 和 `tandem-cli` 都已被用走，所以 001 階段不發布到 npm；你們兩個先從 repo 安裝（`npm install` 加 `npm link`）。正式套件名稱等 Q-20261115-1c9 決定。

## 原則檢查（spec-kit 稱為 Constitution Check，開始實作前必須全部通過）

| 原則 | 來源 | 這份計畫怎麼做到 |
|---|---|---|
| 輕鬆：邀請就能開始，人不用學規則 | D-20261115-0e4 | 一個指令開始；agent 負責記錄；git 同步全自動 |
| 兩家 agent 平等 | FR-007 | 同一份管理區塊、技能檔、hook 指令；兩家都要過 quickstart 情境 F |
| 不經手 AI 服務的憑證 | FR-017、Anthropic 條款 | 只呼叫使用者自己已登入的 agent；Tandem 不碰 Anthropic、OpenAI 的任何東西 |
| 不覆蓋使用者的檔案 | FR-002 | 只改標記區塊內的內容；`--remove` 能完整移除 |
| 原話不能被改寫 | FR-008 | 寫入時驗證；引用別人必須有出處網址 |
| 照搬驗證過的做法 | D-20261115-3d9 | 每個選擇都在 research.md 有來源 |
| 不先問就不改 repo 設定 | AGENTS.md 安全規則 | 開 Discussions、邀請別人都先問使用者 |

## 專案結構

### 文件（這個功能）

```
specs/001-core/
├── spec.md          做什麼、為什麼
├── plan.md          這份
├── research.md      技術選擇和來源
├── data-model.md    資料格式
├── contracts/
│   ├── cli.md                 指令
│   └── agent-integration.md   和兩家 agent 的整合
├── quickstart.md    驗收測試
└── tasks.md         之後產生：實作步驟清單
```

### 程式碼（repo 根目錄）

```
packages/
├── contracts/        zod 格式定義：決定、狀態、brief 輸出、看板 API。不做任何讀寫
├── core/             所有邏輯
│   ├── records/        讀寫和驗證決定、狀態（tandem check 的規則）
│   ├── git/            git 指令排隊、同步、衝突偵測
│   ├── github/         Octokit：邀請、Discussions、Issues、PR、ETag 快取
│   ├── auth/           裝置碼登入、鑰匙圈、gh 備援
│   ├── brief/          計算變動摘要、誰在等誰
│   ├── agents/         寫入管理區塊、hook、技能檔（init / --check / --remove）
│   └── state/          .git/tandem/state.json
└── client-runtime/   看板的狀態管理和重新連線（之後桌面版共用）
apps/
├── cli/              tandem 指令；同時提供看板網頁（建置時把 web 的產出放進來，參考 T3 Code）
└── web/              看板介面（Vite + React）
tandem/               我們自己用 Tandem 的資料（遷移後）
notes/friction/       卡點紀錄（我們的研究，不是產品資料）
specs/                規格
```

之後加：`apps/desktop`（002）、`apps/mcp`。

## 實作順序

照 spec-kit tasks 的分法：先共用基礎，再依使用者情境的優先度，每一階段結束都能單獨測試。

| 階段 | 內容 | 完成時可以測 |
|---|---|---|
| 1. 設定 | monorepo、contracts、測試環境、CI | `npm test` 通過 |
| 2. 基礎 | 紀錄讀寫和驗證、git 排隊同步、GitHub 登入和用戶端、本機狀態 | `tandem check` 能檢查現有紀錄 |
| 3. 情境 3：記決定 | `tandem decide`（含 `--dry-run` 回條）、遷移我們現有的 14 筆決定 | 在對話中記一筆，對方 pull 後看得到 |
| 4. 情境 2：開工報告 | `tandem brief`、`tandem status`、`tandem init` 寫入管理區塊和兩家 hook、技能檔 | quickstart 情境 B、F |
| 5. 情境 1：開始和邀請 | `tandem invite`、`tandem join`、Discussions 開啟流程、`tandem doctor` | quickstart 情境 A |
| 6. 情境 5：看板 | 本機伺服器、看板介面、背景同步、SSE 即時更新 | quickstart 情境 E |
| 7. 情境 4、7：討論和任務 | `tandem ask`、`disagree`、`resolve`、`task`；看板顯示誰在等誰 | quickstart 情境 C |
| 8. 收尾 | 兩家各跑一次完整 quickstart、修正卡點 | Roy 正式測試 |

第 3 階段完成後，我們自己就開始用 `tandem decide` 記錄開發 Tandem 的決定（D-20261115-5f1：用 Tandem 開發 Tandem）。

## 開始前需要人做的事

1. ~~開 Discussions~~：2026-11-15 已開啟。
2. ~~git 作者名稱~~：已在這個 repo 設成 `jielle2453`。
3. **註冊 OAuth App**：001 先借用 `gh` 的登入（D-20261115-w7m2），不用註冊。要給沒裝 `gh` 的人測試前，再請組織擁有者在網頁上建立 OAuth App、開啟 Device Flow，把公開的 Client ID 給我。
4. **測試用 repo（選擇性）**：整合測試需要一個可以亂開討論和 issue 的 repo，例如 `sudo-studio-lab/tandem-sandbox`。

## 複雜度紀錄

| 增加的複雜度 | 為什麼需要 | 更簡單的做法為什麼不行 |
|---|---|---|
| monorepo（多個套件） | 命令列、看板、之後的桌面版和 MCP 共用同一份邏輯 | 一個套件也能做，但桌面版和 MCP 會各寫一份邏輯，行為不一致（T3 Code、Backlog.md 都分開） |
| 自己的 OAuth App | 被邀請的人沒有 gh 也能登入 | 只用 gh：沒裝 gh 的人用不了 |
| 兩家 agent 各自的 hook 設定 | 開工報告要可靠 | 只靠 AGENTS.md 文字：agent 可能忘記執行 |
