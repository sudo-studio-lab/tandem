# Codex 實測步驟（給 @theroyatlas）

003 的 Codex 部分是照官方文件寫的，@jielle2453 的電腦沒有裝 Codex，所以還沒真的跑過。這份是請你在自己電腦上測的步驟。大約 20–30 分鐘，會用到一點你的 Codex 額度。

## 準備

1. 安裝並登入 Codex（如果還沒有）：

```
npm install -g @openai/codex
codex login
```

2. 拿到這個分支並建置：

```
git fetch
git checkout jielle2453/003-agent
npm install
npm run build
cd apps/cli && npm link
```

3. 打開記錄檔（可以看到 Tandem 和 Codex 之間每一行訊息，只存在你的電腦上）：

```
$env:TANDEM_AGENT_LOG = "$HOME\tandem-codex.log"
```

## 一、自動測試

```
$env:TANDEM_CONF_AGENTS = "codex"
npm run test:agents
```

跑完會產生 `tests/agents/last-report.md`。

## 二、在 app 裡用

```
tandem
```

1. 上方按「跟 AI 對話」→ 左下「AI 設定」。Codex 應該顯示「已用訂閱登入」或「已用 API key 登入」。
2. 「新對話」→ 選 Codex 和一個模型 →「開始」。
3. 依序試：
   - 「最近團隊決定了什麼？」→ 應該會用 Tandem 的工具查。
   - 「建立檔案 zz-codex.txt，內容是 hi」→ 應該跳出核准卡片；按「拒絕」，檔案不應該出現。
   - 再要求一次，按「同意」，檔案應該出現（測完刪掉）。
   - 請它「從 1 數到 300，每行一個」，中途按「停止」，再說「繼續」。
4. 如果你想測登入：在 AI 設定裡登出 Codex，再按「用 ChatGPT 帳號登入」，應該會打開 OpenAI 的登入頁。

## 要回報的

- `tests/agents/last-report.md` 的內容。
- 第二部分哪一步不對、畫面上看到什麼。
- `tandem-codex.log`：**先看過再給**。裡面有你們的對話內容；可以只貼出錯前後幾行。

## 我們最不確定的地方（research B 段）

1. `codex -c mcp_servers.tandem...=... app-server` 能不能把 Tandem 的工具加進去（不改你的 `~/.codex/config.toml`）。
2. 核准請求的格式（`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`），以及我們回的 `{ decision: "accept" | "acceptForSession" | "decline" }` 對不對。
3. `model/list`、`account/read` 的欄位。
4. API key 登入的指令（`codex login --with-api-key`）。
