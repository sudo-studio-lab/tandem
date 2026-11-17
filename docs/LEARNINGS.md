# Tandem 實作經驗

## 回答程序：設定隔離、協定驗證與實際模型驗收分開

promote: yes

- 在本次檢查的 Codex CLI 0.164.0，`mcp_servers={}` 不會清除繼承的 server 設定。需明確停用各項，再用 `config/read` 確認；不能確認時停止，不退回一般權限。命令工具、plugins、hooks、multi-agent 與 web 功能也各自關閉。
- Claude 的 `--bare` 不讀 OAuth／keychain，不能拿它當訂閱帳號的隔離開關。回答模式使用受限工具、嚴格 MCP 設定、空工作目錄，另外停用 CLAUDE.md 與 auto memory 的讀取；不更換登入方式。
- 設定回讀只能證明設定值。沒有送出模型回合，就不能聲稱工具隔離已經過真實模型驗收。
- 遠端的「已開放」紀錄不能成為本機啟動 AI 的授權；本機 consent、資料 repo 的私人可見性、專案路徑與輸出憑證檢查都要保留。
- 停止與回覆是兩個人的獨立寫入，回覆落地時還要驗證停止紀錄未出現；只在開始回答前檢查一次會漏掉競態。本次以兩個本機 git 副本驗證這個邊界，沒有替代真人雙機測試。

## ACP：已安裝、已認證、能列模型與實際推論分開驗證

promote: yes

- `initialize` 與空的 `session/new` 可檢查協定、認證及模型清單；不送 `session/prompt`，不能聲稱已完成真實模型驗收。
- 本機 Grok、Cursor 能完成上述檢查；獨立 Antigravity ACP 執行檔可啟動但要求認證。T3 的隔離 profile 與獨立 runtime 不能假定共用登入，更不能複製其憑證。
- Cursor 的模型參數字串必須使用 ACP 實際提供的選項。對 `default[fast=false]` 的設定回覆為 Invalid params，不能靠自行改字串假裝已關閉 fast。這次只列符合目前不啟用 fast 規則的具體選項。
- Windows 的絕對執行檔路徑應先用檔案存在性直接解析；不能依賴 `where` 找到未在 PATH 的 ACP 程式。

## 草稿與 queue：保存使用者尚未送出的工作

promote: yes

- 文字同步存於 localStorage，圖片存於 IndexedDB，依專案與對話隔離；非同步讀取不可覆蓋使用者剛輸入的內容，圖片寫入依序處理。
- 送出失敗保留草稿；成功後只清除當次送出的版本。不能把重新開啟對話後看得到文字當成圖片也已保存。
- queue 與當前回合的 steer 是不同操作。停止、provider 錯誤或程式重開後暫停 queue，避免未經當前使用者操作自動續跑。
- 取消必須等原回合結束，才容許下一則訊息；否則舊回合的完成通知可能清掉新回合狀態。

## 中文既有介面與生成圖的工具限制

promote: yes

- 本次 font-match 排名忽略 Windows 系統字體，並為繁中文字推薦 Orbitron／Ewert 等字體。這不是改字體的充分理由；保留使用者已確認的既有字體系統。
- comp-diff 的 fixed-box missing 可能來自元件位置或對話內容改變；要檢查成對截圖，不能把可見控制項判成不存在。
- 本次 component-review 的計畫為 0 assets，仍要求額外使用者核准才讓 build-phase 從 plates 繼續。不得偽造核准或手改為全通過；保留這項工作流限制，與介面功能驗證分開回報。
