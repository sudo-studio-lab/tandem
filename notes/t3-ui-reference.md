T3 的基礎元件可以拆出來用，但要先整理樣式工具與設計 token，不能整包複製。  
指令面板、composer、diff、側欄的完整功能都綁 T3 資料與狀態；借外殼或互動較小，整套移植接近重寫，Chat 區與進行中工作重疊。  
是否讓 Tandem 長得像 T3，由共同開發者決定；這份盤點只列選項與代價，沒有改產品程式或對 repo 留言。

# T3 UI 用在 Tandem：共同討論版

2026-11-16。唯讀原始碼盤點，**未做實際搬移、安裝、build、測試或視覺驗收**。來源為 T3 v0.1.9 與 sudo-studio-lab/tandem 的 main 快照；另外只讀進行中工作的 DESIGN／PRODUCT。後兩份是「**還沒 commit、可能還會變**」，不能當作已合併功能。

## 可以搬什麼

S＝底層備妥後複製加小改，約每件 0.5–2 小時；M＝拆內部相依、重接 Tandem，約每組 0.5–2 人日；L＝重建資料契約，約每大功能 3–8 人日以上，composer／完整 diff 含後端可能超過 1–2 週。**全部是靜態推估，不是承諾，不能直接相加。**

以下位置皆為 repo 內相對路徑。「基礎包」指按需使用 Tailwind 4、Base UI、CVA、tailwind-merge、Lucide；React／ReactDOM 已有。其授權分別為 MIT、MIT、Apache-2.0、MIT、ISC；T3 來源本身為 MIT。

| 元件／做法 | T3 位置 | Tandem 用途 | 工量 | 要帶／要拆的依賴 | 授權 |
|---|---|---|---|---|---|
| Button、Badge、Alert、Input、Textarea、Label | apps/web/src/components/ui/ | 表單、狀態、按鈕；Chat 輸入與進行中修改重疊 | S | 基礎包按需；先拆純 cn | MIT＋Apache-2.0，圖示另 ISC |
| Checkbox、Radio、Switch、Select、Toggle／ToggleGroup | 同上 | 設定／選擇／篩選；Chat 模型選擇重疊 | S | Base UI、純樣式工具，選項由 Tandem 提供 | 同上 |
| Dialog、AlertDialog、Sheet | 同上 | 邀請、設定、建房、刪除確認 | S | Dialog 樣式、ScrollArea、關閉期間內容保留 | 同上 |
| Menu、Popover、Autocomplete、Combobox | 同上 | 專案切換、搜尋與局部操作 | S | closing-positioner、Input、ScrollArea 等小 helper | 同上 |
| Tooltip | 同上 | 圖示補充說明 | M | 拆 native titlebar 的 T3 env 假設 | MIT＋Apache-2.0 |
| Empty、Table、Group、Separator、Kbd、DiscoveryList、Collapsible | 同上 | 看板空狀態、分組、詳情、快捷鍵提示 | S | 純樣式工具／部分 Base UI；Table 不含排序分頁 | MIT＋Apache-2.0 |
| Spinner、RefreshIcon、Skeleton、MiddleTruncate | 同上 | 載入、重新整理、長名稱 | S | visibility／resize helper 與相應 CSS utility | MIT＋Apache-2.0，圖示另 ISC |
| DraftInput、Wizard | 同上 | 短欄位編輯、開專案流程 | S／M | commit-on-blur、AnimatedHeight／Dialog；不含聊天草稿儲存 | MIT＋Apache-2.0＋ISC |
| Toast 及 helpers | 同上 | 原有錯誤提示、複製、儲存回饋 | M | 拆 draft store、thread route、協定；重定專案／房間 scope | 基礎包授權；原樣全鏈未閉合 |
| Command 外殼＋CommandPaletteContent | ui/command.tsx；CommandPaletteContent.tsx | 搜尋、切專案、看板／房間導覽（新增） | M | Base UI Dialog＋Autocomplete，**不是 cmdk**；替換標題列 adapter | MIT＋Apache-2.0＋ISC |
| 完整 CommandPalette | apps/web/src/components/CommandPalette.tsx | 同上，但內建 T3 actions 不適用 | L | router、Effect atom、store、RPC、專案與 thread 操作 | 主要套件 MIT 等；全鏈未閉合 |
| Tiptap 編輯器／完整 ChatComposer | ComposerPromptEditorTiptap.tsx；chat/ChatComposer.tsx | 個人 Chat；Room 需另定簡版 | L | Tiptap、model／citation／context nodes、附件與執行狀態；**進行中修改重疊** | 四個 Tiptap 入口 MIT；全鏈未閉合 |
| DiffPanelShell／StyledDiffCodeView | DiffPanelShell.tsx；diffs/StyledDiffCodeView.tsx | 新只讀修改預覽 | S／M | @pierre/diffs、worker、theme adapter、highlighter | Apache-2.0；小 helper 另 MIT／Apache-2.0 |
| 完整 DiffPanel | apps/web/src/components/DiffPanel.tsx | main 尚無等價完整畫面 | L | 新 patch 資料契約、VCS/review、檔案樹與 T3 patch | Apache-2.0／MIT／ISC；全鏈未閉合 |
| ui/sidebar | apps/web/src/components/ui/sidebar.tsx | 個人 Chat 清單；全站導覽另定 | M | resize、storage、Effect Schema、可存取性公告 | MIT＋Apache-2.0＋ISC |
| 完整 Sidebar／AppSidebarLayout | apps/web/src/components/ | 若另定整體佈局 | L | router、dnd-kit、environment/thread/project 與執行狀態 | 主要套件 MIT 等；全鏈未閉合 |
| Calendar、ColorPicker、NumberField、PanelTabCloseButton | ui/ | 沒有明確現成對應；有需求才加 | S／M | 日曆另 @daypicker/react；其餘依用途 | MIT＋Apache-2.0，圖示另 ISC |
| QRCode、PreviewCard | ui/ | 邀請 QR、成員／任務摘要（新增） | S | QR 的內嵌演算法通知；預覽的觸控入口 | MIT，樣式工具另 Apache-2.0 |
| StandalonePage | ui/standalone-page.tsx | SignIn／錯誤頁只借結構 | M | **去掉 T3Wordmark，不搬品牌** | 程式 MIT；品牌不作使用權推定 |

完整盤點包含 ui 的 **52 個非測試來源檔（含 helper）**，以及 10 個功能／外殼入口；表格為同用途分組，不代表每件都要搬。

## 為什麼不能看外觀就估「直接搬」

以下是去重後的**直接／間接內部檔案引用數**，包含型別、re-export 與字面量 dynamic import；不是 bundle 大小，也不是最後必搬數量。來源未建圖譜索引，本輪以原始碼文字掃描補查，沒有宣稱完整符號分析。

| 入口 | 直接／間接 | 最難拆的部分 |
|---|---:|---|
| Button | 1／246 | cn 所在 utils 還引用草稿 store 與協定；只在記憶體截斷 utils 後，總數剩 1 |
| Dialog | 4／246 | 共用 cn 與樣式；截斷 utils 後總數剩 4 |
| ui/command | 5／246 | 標題列與共用 UI；截斷 utils 後總數 8 |
| Toast | 10／272 | 當前 thread、environment、draft、可見期間 |
| ui/sidebar | 11／245 | storage／resize／手機狀態；截斷 utils 後總數 15 |
| CommandPalette | 85／850 | 大量 T3 actions、router、資料查詢 |
| Tiptap 編輯器 | 33／793 | 自訂引用 nodes、模型與檔案呈現 |
| ChatComposer | 111／715 | 附件、語音、模型、draft 與執行流程 |
| DiffPanel | 54／504 | VCS/review／檔案資料契約 |
| Sidebar | 83／523 | 專案、thread、環境、排序與操作 |

「截斷」是統計模型中把 utils 當葉節點，沒有改程式或驗證編譯；仍須提供必要 helper。原樣可達數含 barrel 造成的擴張；不涵蓋所有變數 import／worker／CSS。它顯示拆分邊界，不能當 runtime 完整性證明。

Diff 還有一項成本：T3 對 @pierre/diffs 1.7.0-beta.3 套了自訂 patch，讓搜尋能顯露收合項目；裝同版本不保證相同行為。renderer 另牽涉 workers、WASM／highlighter 與 theme，未量實際效能。

## 互動可以借，多人的語意要保留

**可借：** 搜尋與鍵盤導覽、對話框焦點返回、IME 不誤送、貼上／undo／草稿隔離、送出狀態分明、可複製錯誤、只讀 diff、手機側欄收合。

**不能直接套：**

- thread 的已讀、置頂、snooze 不能取代「誰在等誰」，更不能因個人收合就算全隊完成。
- T3 有多環境與分享能力，但本次控制軸仍是使用者的 project/thread/environment；Tandem 房間要保留主持人、參與者、發言、執行、核准的分界。
- toast 不是團隊共享紀錄；重要等待、決定與錯誤要可回看、有來源。
- 本機檔案／終端機 context 不能自動變共享附件；其他成員可能無法讀取。
- 本地 diff review 不能當作共同接受修改，還需作者、版本、授權與決定原話。
- People／Waiting／Mine／Decisions／Discussions／Tasks 沒有對等 T3 業務件，只能借 primitives 重組呈現。

## 底層準備與三個選項

| 選項 | 代價 |
|---|---|
| A．只借行為，保留現有 CSS | 不必加入 Tailwind／CVA，但要自行重整樣式；不能直接複製 className |
| B．少量 primitives，映射既有 token | Tailwind 4＋Base UI＋純 cn／CVA／tailwind-merge，Lucide 按需；底層＋首組約 2–4 人日，保留 Tandem 外觀仍可行 |
| C．另定整體外觀與佈局 | B 之外需共同選方向、導覽與手機規格；完整功能另外按 L 估 |

B 會影響 apps/web/package.json、根 package-lock.json、apps/web/vite.config.ts、src/styles.css、src/main.tsx／App.tsx、components/ui.tsx，以及選中的 Dialogs／Header／Picker。可能新增 components/ui 與純 cn／token 檔；Chat／Room 要等進行中工作合流後重查。以上只是未來預估，**本輪沒有改檔**。

特別注意：

- **token 同名不等義**：Tandem 的 accent 是主要藍色、muted 是次文字；T3 常用這兩者表示背景。應分命名空間映射。
- Tailwind Preflight／CSS layers 與原有手寫樣式可能互相覆蓋，不能整份搬 T3 index.css。
- T3 的 .dark 與 Tandem 的 prefers-color-scheme 要統一；sidebar 767px 與現有設計斷點也不同。
- Dialog／Menu 要保留 portal、Base UI data attributes、關閉內容與焦點；Tandem 原有 native dialog 已有基礎能力。
- 不必為 primitives 搬 TanStack Router、zustand、Effect 整層、Clerk、登入或桌面 shell。

## 授權與素材

**已查證：** 固定版本 npm view 回傳 Base UI 1.9.0／Tailwind 4.3.3／tailwind-merge 3.6.0 為 MIT；CVA 0.7.1 為 Apache-2.0；Lucide 0.564.0 為 ISC；四個 Tiptap 3.31.3 入口為 MIT；Pierre diffs 1.7.0-beta.3 與 trees 1.0.0-beta.6 為 Apache-2.0。完整套件表在完整版，沒有把所有套件統稱 MIT。

| 素材 | 查到的授權／處理 |
|---|---|
| Inter 5.3.0 | OFL-1.1；一般 UI 可保留系統繁中字型 |
| Office fonts 0.4.0 | Apache-2.0 AND OFL-1.1；文件預覽才需要 |
| 終端機 Symbols Nerd Font Mono | 隨附 LICENSE 為 MIT；不推廣到所有 Nerd Fonts |
| 四個 bundled mp3 | repo 通知明列 CC0-1.0；未另開外部音源頁複核 |
| KaTeX 數學字型 | repo 通知為 OFL-1.1 |
| QR 演算法 | 內嵌 MIT 通知需保留 |
| T3 icons／favicon／wordmark、app association | 不搬品牌與關聯設定 |
| MCP／provider／source-control logos、inline SVG | 個別品牌權利未逐項核對；排除搬移 |
| Pierre／Lucide sprite | 套件與部分 icon 通知不同，要保留各自授權 |

套件 metadata 與本地通知是證據，**不是全部發行檔、間接依賴與品牌權利已審完**。Office add-on、字型 notices、完整 Tiptap extensions／ProseMirror 與 diff 全鏈尚未逐包結案。

## 已查證／推論／不確定

**已查證：** 來源快照、元件與 import 範圍、主要 package license、Tandem main 僅以 React／ReactDOM 作 web runtime dependencies、手寫 CSS、既有原生 Modal／toast、房間主持人與參與者分界。notes/design.md 明示 prototype 不是共同定案。

**推論：** S/M/L、人日、三種採用路線與多人語意調整；沒有試搬校準，也沒有代選風格。

**不確定：** 進行中 Chat 最終契約；CSS／IME／手機鍵盤／worker 效能；真實多人流程；全部間接依賴與內嵌品牌授權。未讀進行中程式，未執行測試或外部服務操作。

收尾已確認兩份程式來源無差異；這份分享版已檢查不含本機路徑與私人識別資訊。報告未提交、發布或留言。

## 最沒把握的三件事

1. Chat 進行中修改最後如何合流，會改變多少可搬邊界。
2. 真正抽離後的工時、CSS／IME 行為與效能重量。
3. 完整搬移時所有間接依賴、字型、inline logo 的授權閉合。

