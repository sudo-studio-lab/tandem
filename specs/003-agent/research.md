# 研究紀錄：在 Tandem 裡直接用自己的 AI（003-agent）

查證日期：2026-11-15。本機 Claude Code 版本 2.1.314（`C:\Users\Jie\.local\bin\claude.exe`）；這台電腦沒有裝 Codex，Codex 的部分只看了官方文件。標 **未驗證** 的要在實作時實測。

## A. Claude

### A1. 規定：可以執行使用者自己的 Claude Code，但不能用 Agent SDK 配訂閱

- **決定**：不用 Agent SDK。直接執行使用者自己安裝的原版 `claude`，登入一律走 Claude Code 自己的流程。
- **依據**（https://code.claude.com/docs/en/legal-and-compliance）：
  - 允許：產品裡執行 Claude Code，條件是「The Claude Code binary must not be modified」，而且每個使用者用自己的 API key 或訂閱登入；也不阻止「an end user from signing in to the unmodified Claude Code binary with their own Claude subscription」。執行它需要同意 Anthropic 的商業條款。
  - 禁止：「Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users」；也不能「collect, store, or intermediate Claude.ai credentials」。
  - Agent SDK 文件（https://code.claude.com/docs/en/agent-sdk/overview）：「Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK.」
  - 名字：不能用「Claude Code」當自己功能的名字；選單裡可以寫「Claude」。
- **T3 Code 怎麼做**：查了本機安裝的 T3 Code，它用 Agent SDK 啟動 Claude，登入則叫使用者到 CLI 自己登入。Agent SDK 那一點是否事先取得同意，查不到。

### A2. 多輪對話：stream-json

- `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`
- 輸入每行一則 `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]},"parent_tool_use_id":null}`（最小欄位 **未驗證**，從型別推出）。
- 輸出（每行一個 JSON）：`system/init`（model、tools、`mcp_servers`、`mcp_server_errors`、`session_id`）、`assistant`、`user`（tool_result）、`stream_event`（文字片段在 `.event.delta.type == "text_delta"`）、`result`（結果、花費、session）。
- 來源：https://code.claude.com/docs/en/headless 、https://code.claude.com/docs/en/cli-reference

### A3. 接續對話

- `--resume <session_id>`；`session_id` 出現在 `system/init`、每則訊息和 `result`。對話在本機保存，Tandem 只記編號。

### A4. 核准：用 MCP 工具接住

- `-p` 模式預設是 Manual：需要核准的動作「is denied unless something approves it, such as a PermissionRequest hook or a --permission-prompt-tool」。
- **決定**：`--permission-prompt-tool mcp__tandem__approve`。Tandem 自己的 MCP 伺服器提供 `approve` 工具，收到請求後問 Tandem 伺服器，等使用者在對話框按同意或拒絕，再回 `{"behavior":"allow","updatedInput":{...}}` 或 `{"behavior":"deny","message":"..."}`（輸入欄位和回傳格式 **未驗證**）。
- 另有 stdin 控制協定（`control_request` / `can_use_tool`、`interrupt`、`set_model`），但原始格式沒有寫在文件裡，只在 SDK 裡。先不依賴它。
- `--permission-mode`：acceptEdits、auto、bypassPermissions、manual、dontAsk、plan。

### A5. 中斷

- 文件寫的方式：控制協定的 `interrupt`（格式未公開），或 SIGINT。Windows 上 Node 送 SIGINT 等於直接結束程序。
- **決定**：先用「結束程序，下一則訊息用 `--resume` 接續」。改過的檔案留著，對話紀錄由 Claude Code 自己保存。實測後再看要不要改用控制協定。

### A6. MCP

- `--mcp-config <檔案或 JSON>`；`-p` 模式不會跳出「信任這個 MCP 伺服器嗎」的詢問，也會連上專案 `.mcp.json` 的伺服器。
- 專案 `.mcp.json`：`{"mcpServers":{"tandem":{"command":"tandem","args":["mcp"]}}}`。在終端機互動模式下，第一次會問使用者要不要啟用（這是 Claude Code 自己的保護，不繞過）。
- **已驗證**（2026-11-15，Claude Code 2.1.314，Windows）：
  - `command` 直接寫 `tandem` 就能啟動（解析到 npm 的 `tandem.cmd`），不需要 `cmd /c`。`--mcp-config` 和專案 `.mcp.json` 都一樣。
  - `-p` 模式會自動連上專案 `.mcp.json` 的伺服器（`system/init` 裡 `source: "project"`、`status: "connected"`），沒有詢問。
  - MCP 工具在 `-p` 模式要被允許才能用（`--allowedTools mcp__tandem__tandem_decisions` 後成功呼叫）。之後由 `--permission-prompt-tool` 接手。
  - `-p` 模式也會跑專案的 SessionStart 和 Stop hook。stream-json 的第一行可能是 `system/hook_started`，不一定是 `system/init`。

### A7. 模型

- `--model` 接受別名（`opus`、`sonnet`、`haiku`、`fable`）或完整 ID；沒有列出模型的指令。
- **決定**：選單列固定別名，加一個「預設」（不帶 `--model`）。

### A8. 登入

- 狀態：`claude auth status --json`（不互動）。本機文字版輸出有「Login method」「Organization」「Email」。JSON 欄位名稱 **未驗證**。
- 登入：`claude auth login`（預設 Claude 帳號）、`claude auth login --console`（API 帳號，key 由 Claude Code 自己建立並保存）。會開瀏覽器，有時要貼回代碼，所以要在終端機裡跑。
- **決定**：「登入 Claude」按鈕開一個小終端機視窗執行 `claude auth login`，結束後重新讀狀態。Tandem 不接觸憑證。
- 優先順序：`ANTHROPIC_API_KEY` 在 `-p` 模式一定優先於訂閱登入。Tandem 不設這個變數（不經手 key），使用者自己設了就照用。
- 憑證位置：`%USERPROFILE%\.claude\.credentials.json`（Tandem 不讀）。

### A9. Windows

- 原生版是 `claude.exe`，可以直接 spawn。npm 版是 `claude.cmd`，Node 不能不透過 shell 直接執行 `.cmd`，要用 `cmd.exe /d /s /c` 並小心處理參數。

## B. Codex

### B1. app-server

- `codex app-server`：stdio，每行一個 JSON，**省略** `"jsonrpc":"2.0"`。先送 `initialize`（`clientInfo`），再送 `initialized` 通知。
- 來源：https://developers.openai.com/codex/app-server（轉址到 https://learn.chatgpt.com/docs/app-server）
- `codex app-server generate-ts --out <dir>` 可以產生型別，但跟 Codex 版本綁在一起。**決定**：產生一份放進 repo 當參考，執行時用 `initialize` 回應判斷版本。

### B2. 對話

- `thread/start`（`model`、`cwd`、`approvalPolicy`、`sandbox`）→ `thread.id`；`thread/resume`；`turn/start`（`threadId`、`input`、可覆寫 `model`、`effort`）；`turn/interrupt`（`threadId`、`turnId`）。
- 通知：`turn/started`、`turn/completed`、`item/started`、`item/completed`、`item/agentMessage/delta`。指令執行和檔案修改的 item 細節 **未驗證**。

### B3. 核准

- 伺服器向 Tandem 發請求：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`。決定值：`accept`、`acceptForSession`、`decline`、`cancel`。回應格式 **未驗證**。

### B4. 登入

- `account/read`；`account/login/start`：`{type:"chatgpt"}` 回傳 `loginId` 和 `authUrl`（在瀏覽器打開，是 OpenAI 自己的頁面）；`{type:"apiKey", apiKey}`；`chatgptDeviceCode`。完成時送 `account/login/completed`。`account/logout`。
- **決定**：ChatGPT 登入用 `authUrl` 開瀏覽器。API key 登入**不**走 `account/login/start {apiKey}`，因為那要 Tandem 收下 key 再轉交；改成開終端機讓使用者執行 Codex 自己的 API key 登入（`codex login --with-api-key`，指令 **未驗證**）。
- 憑證存在 `~/.codex/auth.json` 或系統認證管理員，Tandem 不讀。

### B5. 條款

- 官方頁面（https://learn.chatgpt.com/docs/auth）建議程式化工作流程用 API key，沒有寫第三方 app 能不能用 ChatGPT 登入驅動 Codex，也沒寫帳號能不能多人共用。app-server 本身提供 ChatGPT 登入，看起來是設計給其他 app 用的。**實作前再查一次**。

### B6. 模型

- `model/list` 回傳 `id`、`displayName`、`isDefault`、`supportedReasoningEfforts`。選單用這份清單。

### B7. MCP

- `~/.codex/config.toml` 的 `[mcp_servers.<名稱>]`；專案的 `.codex/config.toml` 只有在專案被信任時才生效。
- **決定**：不改全域設定。寫專案的 `.codex/config.toml`；從 Tandem 啟動時，改用啟動參數覆寫設定（`-c` 是否適用於 app-server **未驗證**）。不行的話，退回現在的 hook 加 `tandem` 指令。

### B8. Windows

- 安裝：`npm install -g @openai/codex`。原生支援 Windows（第三方說法，官方頁面這次沒讀到）。

## C. MCP 伺服器

- 套件：`@modelcontextprotocol/sdk`（目前 1.32.2），需要 zod（我們已經用 zod 4）。用 `McpServer` 加 `StdioServerTransport`。
- 工具結果：`{content:[{type:"text",text:"..."}], isError?: true}`。
- **決定**：`tandem mcp` 放在 `apps/cli`，呼叫 `packages/core`，跟命令列共用同一份邏輯。桌面版用同一個 shim 執行。

## D. 參考：其他工具怎麼讓別人進對話（給 004-room）

| 工具 | 誰的 AI | 別人怎麼參與 |
|---|---|---|
| Readback | API key（GMI Cloud） | 兩人直接輸入同一個 agent；每則訊息有回條，原話釘在板上 |
| Omnigent | 主持人的訂閱，主持人電腦上跑 | 大家一起操作，也能按核准 |
| T3 Code 訪客連結 | 主持人的訂閱 | 訪客能送訊息，但要主持人按一下才送出 |
| claude-share 類 | 主持人的訂閱 | 只能看、提建議 |

## 要實機驗證的項目

1. Claude stream-json 輸入的最小格式；`--permission-prompt-tool` 的輸入和回傳格式。
2. Windows 上結束 `claude` 程序後 `--resume` 是否完整接續。
3. `claude auth status --json` 的欄位。
4. Codex app-server 的核准回應格式、指令和檔案修改的 item 格式。
5. Codex 能不能不改全域設定就接上 Tandem 的 MCP。
6. Codex 自己的 API key 登入指令。
7. 兩家在 Windows 上從 GUI 程式（Electron）啟動時，PATH 和環境變數是否正確。

## 實機驗證結果（2026-11-15，Claude Code 2.1.314，Windows）

1. **stream-json 輸入**：一行 `{"type":"user","message":{"role":"user","content":"文字"}}` 就夠（content 可以是字串或 text 區塊陣列）。stdin 不關，程序就一直活著，可以連續送好幾則；每則各有一個 `result`，`session_id` 不變。
2. **核准**：`--permission-prompt-tool mcp__tandem__approve` 收到 `{tool_name, input, tool_use_id}`；回 `{"behavior":"allow","updatedInput":...}` 或 `{"behavior":"deny","message":"..."}`（放在工具結果的文字裡）。拒絕的訊息會原樣交給 agent；`result.permission_denials` 會列出被拒的動作。唯讀的指令（例如 `echo`）不會來問。
3. **中斷**：`taskkill /T /F` 約 0.2 秒結束。之後 `--resume <session_id>` 記得之前的內容；被中斷那一則的回覆沒有保存（agent 以為還沒開始），可以接受。
4. **登入狀態**：`claude auth status --json` 欄位：`loggedIn`、`authMethod`（例如 `claude.ai`）、`apiProvider`、`subscriptionType`、`orgName`、`email`。Tandem 只用 `loggedIn`、`authMethod`、`subscriptionType`，不顯示也不保存 email。
5. **啟動**：Node 不經過 shell 直接 `spawn("claude")` 可以執行（原生版 `claude.exe`）。
6. Codex 的項目（4、5、6）交給 @theroyatlas 實測。
