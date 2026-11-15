# 實作計畫：Tandem 桌面版（002-desktop）

**對應**：`spec.md`、`research.md`（S1–S10）
**平台**：只做 Windows（兩個使用者都用 Windows）。程式不寫死 Windows 專用的做法，之後加 macOS 時只需要補平台相關的部分。

## 技術背景

| 項目 | 選擇 | 依據 |
|---|---|---|
| 桌面殼 | Electron + electron-builder（NSIS、per-user、oneClick）+ electron-updater | R19、S6、S10，T3 Code 和 GitHub Desktop 都用 Electron |
| 伺服器 | 沿用 `apps/cli` 的 Hono 伺服器，改成多專案；Electron 用 `ELECTRON_RUN_AS_NODE` 啟動它 | S9 |
| git | 內建 dugite；`runGit` 先看 `TANDEM_GIT` | S3 |
| 紀錄寫入 | git plumbing 直接寫到 `origin/<預設分支>`，加本機 outbox 和檔案鎖 | S1、S9 |
| 登入 | OAuth App 裝置碼流程；權杖存 Windows 認證管理員（`@napi-rs/keyring`） | S5 |
| CLI 給 hook 用 | `%LOCALAPPDATA%\Tandem\bin` 的 `tandem.cmd` 和 sh shim，加進使用者 PATH | S4 |
| 發布 | 公開 repo `sudo-studio-lab/tandem-releases`：Releases 放安裝檔，Pages 放下載頁 | S8 |

## 架構

```
Electron 主行程（apps/desktop）
 ├─ 單一實例、tandem:// 連結、托盤、通知、開機啟動、自動更新、PATH shim
 ├─ spawn: <Tandem.exe> <cli bundle> serve --port 0   (ELECTRON_RUN_AS_NODE=1，通行碼經 stdin)
 │     └─ apps/cli 伺服器（多專案）── packages/core ── dugite git、GitHub API
 └─ BrowserWindow.loadURL(http://127.0.0.1:<port>/?t=<通行碼>)  ← apps/web

agent hook ── tandem.cmd ──> 同一個 cli bundle（另一個行程，靠檔案鎖和伺服器協調）
```

- 瀏覽器版照樣能用：在 repo 裡執行 `tandem` 會啟動同一個多專案伺服器，並先選好目前的 repo。
- 通知：伺服器算出要通知的事，用 SSE 送出 `notify` 事件。Electron 主行程訂閱 SSE、跳 Windows 通知，並更新托盤數字。瀏覽器版只在看板上顯示。

## 資料流程的改動（S1）

`packages/core` 新增 `DataStore`，records 改成透過它讀寫，不再直接讀寫工作目錄：

```ts
interface DataStore {
  readonly repoRoot: string;
  defaultBranch(): Promise<string>;
  list(dir: "decisions" | "status"): Promise<string[]>;      // tandem/<dir>/ 底下的檔名
  read(path: string): Promise<string | null>;               // repo 相對路徑，例如 tandem/status/x.md
  write(changes: { path: string; content: string | null }[], message: string): Promise<WriteResult>;
  flush(): Promise<WriteResult>;                            // 重試 outbox
  snapshot(): Promise<string | null>;                       // origin/<預設分支> 的 commit，給 brief 算「上次之後」
}
```

- `openGitDataStore(repoRoot, { token })`：讀 `origin/<預設分支>:tandem/`，再疊上 outbox 裡的內容。寫入時先進 outbox，再在檔案鎖內 fetch、用暫時的 index 建 commit、push。被拒絕就重做，離線就留在 outbox。
- `openFsDataStore(root)`：直接讀寫資料夾，給測試和還沒有遠端的 repo 用。
- `syncData` 只剩「flush outbox 加 fetch」。不再 commit、pull 或 push 使用者的分支。

## 伺服器 API（多專案）

全部需要通行碼換來的 cookie（001 R13）。事件經 `GET /api/events`（SSE，格式見 `packages/contracts/src/app.ts` 的 `AppEvent`）推送。

| 方法 | 路徑 | 用途 |
|---|---|---|
| GET | `/api/session` | `AppSession`：登入的人、專案清單、目前專案 |
| POST | `/api/login/device` | 開始裝置碼登入，回傳 `DeviceLoginStart` |
| GET | `/api/login/device/:id` | 查詢登入狀態 `DeviceLoginState` |
| POST | `/api/logout` | 刪除 keyring 裡的權杖 |
| GET | `/api/github/repos?q=` | 我有寫入權限的 repo（`RepoChoice[]`） |
| GET | `/api/github/owners` | 可以建 repo 的帳號和組織（`OwnerChoice[]`） |
| GET | `/api/invitations?hint=owner/name` | 待接受的邀請（`Invitation[]`） |
| POST | `/api/invitations/:id/accept` | 接受、clone、設定，回傳 `{ opId }`，進度用 `progress` 事件推送 |
| POST | `/api/projects` | `{ repo: "owner/name", dir? }`：從現有 repo 開始，回傳 `{ opId }` |
| POST | `/api/projects/new` | `{ owner, name }`：建立私人 repo 再開始，回傳 `{ opId }` |
| POST | `/api/projects/open-folder` | `{ path }`：加入本機已有的 repo |
| DELETE | `/api/projects/:id` | 從清單移除（不刪檔案） |
| POST | `/api/projects/:id/select` | 設成目前專案 |
| GET | `/api/projects/:id/board` | `ProjectBoard` |
| POST | `/api/projects/:id/refresh` | 重新抓 GitHub |
| POST | `/api/projects/:id/sync` | 立即 flush outbox 加 fetch |
| POST | `/api/projects/:id/invite` | `{ login }` → `{ shareText, url }` |
| GET | `/api/agents` | `AgentAvailability[]` |
| POST | `/api/projects/:id/open-agent` | `{ agent }`：在專案資料夾打開 agent |
| POST | `/api/projects/:id/open-folder` | 用檔案總管打開資料夾 |
| GET/PUT | `/api/settings` | `AppSettings` |

本機的 app 設定（專案清單、通知設定、已通知過的 id、預設專案資料夾）存在 `%APPDATA%\Tandem\app.json`，不進 repo。

## 專案結構（新增和修改）

```
packages/contracts/src/app.ts        002 的型別（已完成）
packages/core/src/data/              DataStore：git plumbing 寫入、outbox、檔案鎖、fs 版
packages/core/src/records/           改成透過 DataStore 讀寫
packages/core/src/git/run.ts         TANDEM_GIT、dugite 環境、權杖注入（只放在子行程的環境變數）
packages/core/src/git/sync.ts        改成 flush 加 fetch
packages/core/src/auth/              裝置碼登入、keyring 權杖、getGitHubToken 新順序
packages/core/src/github/            repo 清單、建立 repo、邀請清單、成員動態（GraphQL）
packages/core/src/activity/          整理成員動態
packages/core/src/notify/            從看板資料算出要通知的事
packages/core/src/app-state/         %APPDATA%\Tandem\app.json
apps/cli/src/server.ts               多專案伺服器、上面的 API、`serve` 模式
apps/cli/src/setup.ts                從 commands.ts 抽出 init、clone、join，給 CLI 和伺服器共用
apps/web/src/                        登入、選專案、邀請清單、成員動態、設定、打開 agent、切換專案
apps/desktop/                        Electron 主行程、shim、托盤、通知、更新、electron-builder 設定
```

## 階段

1. **共用格式**：`contracts/app.ts`（已完成）。
2. **平行開發**（Sonnet，各自只動自己的資料夾）：
   - A：DataStore 和 records 改寫，同步改成 flush 加 fetch（`packages/core/src/data`、`records`、`git/sync.ts`）
   - B：登入、GitHub 新功能、動態、通知計算、app 設定、`runGit` 環境（`auth`、`github`、`activity`、`notify`、`app-state`、`git/run.ts`）
   - C：看板介面（`apps/web`），先用假資料
   - D：Electron 殼（`apps/desktop`）
3. **串接**（我做）：伺服器 API、`setup.ts`、CLI 改用 DataStore、hook。
4. **打包**：dugite 打包、安裝檔、shim 在 Claude Code 和 Codex hook 下實測。
5. **端到端**：兩個帳號、兩台電腦，照 spec 的情境 1–4 走一次。

## 人工前置步驟（需要 @jielle2453 做）

1. **在 sudo-studio-lab 組織建立 OAuth App**（Settings → Developer settings → OAuth Apps → New）：
   - Application name：`Tandem`
   - Homepage URL：`https://github.com/sudo-studio-lab/tandem-releases`
   - Authorization callback URL：`http://127.0.0.1/callback`（裝置碼流程用不到，但這是必填欄位）
   - 勾選 **Enable Device Flow**
   - 建立後把 **Client ID** 給我。Client ID 是公開的；不需要 client secret，也不要產生。
2. **建立公開 repo `sudo-studio-lab/tandem-releases`**，用來放安裝檔和下載頁。我也可以代建，但要你同意，因為它是公開的。
3. **確認兩台電腦的 Smart App Control**：設定 → Windows 安全性 → 應用程式與瀏覽器控制 → Smart App Control。如果是「開啟」，沒簽章的安裝檔會被直接擋下。

## 原則檢查

| 原則 | 怎麼做到 |
|---|---|
| 輕鬆、邀請就能開始（D-20261115-r6x9） | 不用終端機；被邀請的人登入就看到邀請 |
| 紀錄直接進 main（D-20261115-gr52） | S1：不管在哪個分支都寫到預設分支 |
| 不碰使用者的程式碼 | 寫入不經過工作目錄；不 pull、不 rebase、不暫存使用者的修改 |
| 不經手 AI 憑證（001 FR-017） | 只打開使用者自己的 agent |
| 金鑰不進 repo | 權杖只存在認證管理員，只放在子行程的環境變數 |
