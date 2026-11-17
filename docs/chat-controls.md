# 對話控制與 provider

這次沿用 A 版：模型／effort、草稿、待處理清單與送出動作集中在對話下方。

- 新對話可選 Claude、Codex、Antigravity、Grok、Cursor；只把原廠工具回報已認證的 provider 列為可使用。
- 現有對話可在空閒時換模型；換模型後繼續原廠同一個 session。無法恢復歷史的 ACP runtime 會明確回報，不能另開空白 session 冒充延續。
- 模型與 effort 使用實際清單。Cursor 不以未驗證的字串改寫 fast 參數；不提供目前帶 fast=true 的選項。
- 可貼上或選擇 PNG／JPEG／GIF／WebP，每則最多 4 張、每張最多 5 MB。圖片在草稿與對話紀錄中可直接查看、放大及下載；原廠回傳的原生圖片內容區塊亦可顯示。文字中的任意本機路徑不會被當成可任意讀取的圖片 API。
- 草稿文字與附件依專案／對話保存，換頁與重新載入後可恢復；房間的訊息輸入也保存文字草稿。
- Codex 使用原生 `turn/steer` 做「立即補充」。目前其他轉接器提供 queue，沒有宣稱它們也能補充當前回合。
- 排隊訊息可編輯或移除，會在目前回覆結束後依序送出。停止、provider 錯誤或重啟後暫停 queue，由「繼續佇列」恢復。

## 登入與安裝

認證全由原廠工具處理，Tandem 不讀取或複製憑證。Grok 使用 `grok agent stdio`、Cursor 使用 `cursor-agent acp`，Antigravity 使用 `agy acp`；Windows 也可使用已安裝的 T3 獨立 ACP 執行檔，但不沿用 T3 的私有 profile。

若工具未在 PATH，可設定 `TANDEM_GROK_COMMAND`、`TANDEM_CURSOR_COMMAND` 或 `TANDEM_ANTIGRAVITY_COMMAND` 為原廠執行檔路徑。不要把 key 放進這些變數。

Antigravity 在本機 metadata probe 中回覆 Authentication required，必須由使用者在其登入流程完成認證。Grok、Cursor 的認證／模型清單 probe 通過，這不代表已測過真實推論。

## 驗證與限制

- `npm test`：單元與模擬協定測試；`npm run typecheck`、`npm run build`。
- `node apps/web/.impeccable/review/browser-check.mjs`：12 項瀏覽器檢查，需可用的 Playwright 與 Chromium。可用 `TANDEM_PLAYWRIGHT_MODULE`（模組 URL）、`TANDEM_CHROMIUM`（執行檔路徑）與 `TANDEM_PREVIEW_URL` 指定本機環境。
- 瀏覽器測試使用明示 MOCK，貼圖是合成 ClipboardEvent，390px 截圖是模擬尺寸；不代替實體手機、系統剪貼簿或真實 provider 回合的驗收。
- `.impeccable/review/browser-results.json` 與桌面／手機截圖保存本機證據。參考圖的操作分組已選定 A，獨立審查列出的三項介面修正已解決；自動化設計流程因 0 assets 的額外核准關卡仍未關閉，不能稱整體設計流程已全通過。
- 尚未替換已安裝的桌面 App，沒有發布新版。
