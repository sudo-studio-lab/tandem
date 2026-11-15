# 介面合約：和 agent 的整合（001-core）

**目標**：Claude Code 和 Codex 完全一樣地做到三件事——開工時報告變動、做決定時記錄原話、收工前更新狀態——而人不用學任何規則（FR-007、D-20261115-0e4）。
**參考**：Beads（`bd prime` 加兩家的 hook）、Backlog.md（`backlog instructions` 加標記區塊）、spec-kit（同一份技能寫到兩家各自的資料夾）。

## 原則

1. **命令列工具是唯一的說明來源**：詳細做法由 `tandem brief` 在執行時印出。寫進使用者 repo 的只有一小段指引（10–15 行），之後改流程不用改大家的 repo（參考 Beads `bd prime`、Backlog.md）。
2. **能用 hook 的用 hook，指示文字當備援**：hook 要等使用者信任專案才會執行；沒信任時，靠 AGENTS.md 裡的文字提醒 agent 自己執行。
3. **兩家用同一份內容**：同一段指引、同一份技能檔、同一個 hook 指令，只是放的位置不同。

## 1. 管理區塊（AGENTS.md）

插在 AGENTS.md **最上方**（Codex 讀 AGENTS.md 的上限是 32 KiB，放最後面可能被截掉）。標記參考 Beads，帶版本和雜湊，`tandem init --check` 才能判斷是否過期。Claude Code 會把 HTML 註解拿掉再給模型看，所以標記不佔空間。

```markdown
<!-- BEGIN TANDEM v:1 hash:… -->
## Tandem（團隊協作）

這個專案用 Tandem 讓每個人的 agent 共享決定和進度。

- **每次對話開始**：如果還沒看到 Tandem 的報告，先執行 `tandem brief`，用五行以內告訴使用者跟他有關的變動；沒有就不用講。
- **使用者做了會影響別人的決定**：用 `tandem decide --dry-run` 產生紀錄，給使用者看「我記成這樣，對嗎？」，確認後再正式執行。原話必須逐字，不能改寫。
- **需要別人回答才做得下去**：`tandem ask`。可以先做、之後再改的事，直接記決定，不要開問題。
- **結束工作前**：用 `tandem status` 更新使用者自己的狀態。
- 詳細做法：`tandem brief` 的輸出。不要改別人的狀態檔和別人的決定。
<!-- END TANDEM -->
```

## 2. 讓 Claude Code 讀到 AGENTS.md

Claude Code 只有在沒有任何 CLAUDE.md 時才會自動讀 AGENTS.md；只要有 CLAUDE.md（甚至只有個人的 CLAUDE.local.md），就不讀了。Anthropic 建議的做法是在 CLAUDE.md 最上方寫 `@AGENTS.md`。
- 沒有 CLAUDE.md：建立一個，內容只有 `@AGENTS.md`。
- 有 CLAUDE.md 但沒引用：在最上方加
  ```markdown
  <!-- BEGIN TANDEM -->
  @AGENTS.md
  <!-- END TANDEM -->
  ```

## 3. Hook

| 事件 | Claude Code（`.claude/settings.json`） | Codex（`.codex/hooks.json`） | 做什麼 |
|---|---|---|---|
| 開工 | `SessionStart`，matcher `startup\|resume\|clear\|compact` | `SessionStart`，matcher `startup\|resume\|clear` | `tandem hook session-start`：把 brief 的內容放進 agent 的脈絡 |
| 壓縮之後 | （SessionStart 的 `compact` 已涵蓋） | `PostCompact` 記號 + `UserPromptSubmit` 重新放入 | Codex 壓縮後會忽略 hook 的純文字，參考 Beads 的做法 |
| 收工 | `Stop` | `Stop` | `tandem hook stop`：這次有做事但狀態沒更新、且 `stop_hook_active` 為 false 時，回傳 `decision: block` 提醒更新狀態；其他情況放行 |

- Stop 每一輪都會觸發，所以只在「真的有變動卻沒更新狀態」時提醒，不能每次都擋。
- 不用 `SessionEnd`：Claude Code 不能用它擋，而且只給約 1.5 秒。
- 一律輸出 JSON。Windows 用 Codex 的 `commandWindows` 欄位。

## 4. 技能（Agent Skills）

同一份標準格式的 `SKILL.md`（只用標準欄位 `name`、`description`），寫到兩個位置：
- Claude Code：`.claude/skills/tandem-<名稱>/SKILL.md`
- Codex：`.agents/skills/tandem-<名稱>/SKILL.md`

| 技能 | 什麼時候觸發 | 內容 |
|---|---|---|
| `tandem-decision` | 使用者說出決定（「就這樣」「好，用 X」「我們決定…」） | 怎麼抓逐字原話、怎麼判斷強度、回條的問法 |
| `tandem-status` | 一段工作告一段落、要結束 | 狀態該寫什麼、成品連結 |
| `tandem-ask` | 卡在需要別人決定的事 | 開問題還是直接記決定的判斷方式 |

## 5. 信任（人無法跳過的一步）

`tandem init` 和 `tandem doctor` 要清楚告訴每個人需要做什麼：
- Claude Code：第一次在這個資料夾開啟時，同意信任這個工作區。
- Codex：信任專案的 `.codex/` 資料夾，用 `/hooks` 檢視並同意 Tandem 的 hook；hook 內容改了要重新同意。

沒有信任時，hook 不會執行，退回靠管理區塊的文字。`tandem brief` 會偵測「這次 session 是不是 hook 觸發的」，`tandem doctor` 會提示。

## 未確認（實作時要驗證）

- Codex 在 `codex exec`（非互動模式）下會不會執行 hook。
- Codex 需要哪個最低版本才支援 hook 放入脈絡（Beads 說 0.129.0 以上）。
- Codex 支不支援 MCP 的 resources 和 prompts（影響之後的 MCP 設計，不影響這份）。
