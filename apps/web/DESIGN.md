---
name: Tandem
description: 現有協作工作介面的視覺規範，從 prototype 實作擷取
colors:
  background: "#f7f7f8"
  surface: "#ffffff"
  surface-secondary: "#efeff1"
  text: "#1d1f24"
  muted: "#5f636b"
  border: "#e3e3e7"
  border-strong: "#cdcdd3"
  primary: "#2f62d8"
  primary-soft: "#e9effc"
  primary-contrast: "#ffffff"
  success-background: "#e3f5ea"
  success-text: "#166534"
  warning-background: "#fff3d6"
  warning-text: "#8a5300"
  error-background: "#fde8e6"
  error-text: "#a3231a"
  warning-border: "#f0c36b"
  error-border: "#f1a9a2"
  info-background: "#e6eefc"
  info-text: "#1c4aa8"
typography:
  body:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Noto Sans TC Variable", -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'
    fontSize: "15px"
    lineHeight: 1.55
  control:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Noto Sans TC Variable", -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'
    fontSize: "0.9rem"
    fontWeight: 500
  caption:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Noto Sans TC Variable", -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'
    fontSize: "0.85rem"
  panel:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Noto Sans TC Variable", -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'
    fontSize: "15px"
    lineHeight: 1.5
  group-label:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Noto Sans TC Variable", -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0"
  meta:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Noto Sans TC Variable", -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'
    fontSize: "13px"
rounded:
  surface: "10px"
  small: "8px"
  group: "14px"
  editor: "10px"
  pill: "999px"
spacing:
  small: "8px"
  medium: "12px"
  large: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-contrast}"
    rounded: "{rounded.small}"
    padding: "6px 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.small}"
    padding: "6px 14px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.small}"
    padding: "6px 14px"
  button-danger:
    backgroundColor: "{colors.error-background}"
    textColor: "{colors.error-text}"
    rounded: "{rounded.small}"
    padding: "6px 14px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.small}"
    padding: "7px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.group}"
---

# Design System: Tandem

## Overview

記錄現有 prototype 的視覺系統，來源為 `src/styles.css`、`Chat.tsx`、`Composer.tsx` 與 `ChatImages.tsx`。已選定的 A 參考圖為 `.impeccable/mocks/chat-a.png`；完成畫面的桌面及手機截圖位於 `.impeccable/review/desktop.png`、`.impeccable/review/mobile.png`，使用明確標示的 MOCK 資料。截圖不代表真實 provider、正式環境或實體手機驗收。

介面以完成協作任務為目的：文字、訊息和操作為主，藍色表示主要操作與目前選擇。使用者本次沒有新增風格偏好，功能擴充沿用現有系統；三版參考圖比較新增控制項的安排，不改品牌。

**方向：換字型＋放大＋分組**（2026-11-18 從 A／B／C 三版中選定 C，取代原本「像編輯器面板」的方向）。中文一律用 App 自帶的 Noto Sans TC，不靠系統字型；正文 15px、一件事一行 48px；同一組的列放在一塊圓角底色裡，分組之間靠留白分開。顏色仍只留給「等你」和出問題。每一頁都照這個方向，不另立風格。

**Key Characteristics:**
- 中性灰表面（不帶藍）、語意色彩及 App 自帶的 Noto Sans TC；深淺色跟著系統。
- 模型、草稿、待處理訊息及輸入操作集中於既有對話面板。
- 桌面並排、窄螢幕換行與單欄，圖片保留實際內容。

## Colors

淺色模式採中性淺灰底、深色文字與藍色操作色，值以 frontmatter 與 `src/styles.css` 為準。成功、警告與錯誤各有專用的背景和文字色。

深色模式依 `prefers-color-scheme: dark` 切換：背景 `#18191c`、表面 `#1e1f23`、次表面 `#26272b`、框線 `#2c2d32`、文字 `#d6d8dd`、次文字 `#8f939b`、操作色 `#6f9bff`、錯誤字 `#f08a7e`。灰色不帶藍，才像編輯器本身的面板。新增功能沿用語意變數，不寫死淺色值。次文字對背景至少 4.5:1。

## Typography

英文和數字用系統介面字型（Windows 是 Segoe UI），中文一律用 App 自帶的 Noto Sans TC 可變字型（`@fontsource-variable/noto-sans-tc`，在 `main.tsx` 載入，切片按需下載，OFL 授權）；不讓系統退回微軟正黑體 UI。按鈕和欄位也繼承同一個字型。看板和各頁正文 15px（`panel`），分組標題 13px、600、次文字色、不加字距（字距會把中文拆散）（`group-label`），列右邊的說明、時間和次要文字 13px 次文字色（`meta`），編號和計數用等寬數字。基準與控制項、次要資訊尺寸見 frontmatter；頁面標題為 1.4rem，對話正文行高為 1.6。次要資訊使用較小字級與次文字色；指令和原始工具輸出使用 `ui-monospace, Consolas, monospace`。未建立新展示字體或 Google Fonts 配對。

## Layout

頂部只佔一行（40px，背景和頁面同色、底下一條細線）：產品標記、專案切換、一個安靜的狀態、成員頭像、⋯ 與設定；只有一個畫面時不顯示導覽。640px 以下藏起產品名稱、owner、正常狀態和頂部成員頭像（看板自己的工具列已有成員，成員與邀請留在 ⋯ 選單）。內容最大寬度為 1240px。桌面對話採 250px 左側清單與可伸縮右側對話區，欄距 16px；對話內由標題、可捲動訊息與底部輸入區組成。

輸入區採 A 的分組順序：模型／effort 與草稿狀態、待處理訊息、附件與文字編輯區、加入圖片與送出操作。桌面編輯區內縮圖和文字並排；輸入區最多佔對話高度 55%，內容過多時可捲動。

斷點為 760px（對話單欄與導覽整列）及 560px（頂欄與一般頁面縮減左右留白、表單單欄）。760px 以下附件改置文字上方，模型與 effort 換行，隱藏鍵盤提示，佇列取消固定最大高度；對話採頁面流動，訊息區最大高度 50dvh、最小高度 220px，輸入區不設最大高度。這是窄視窗適配，非實體裝置驗收。

## Elevation & Depth

淺色面板與目前選取的導覽使用既有細框與低陰影，彈出選單和對話框有較大陰影；深色模式的低陰影為 none。完整明暗陰影數值記於 `.impeccable/design.json`，來源是 CSS，不另造裝飾效果。

## Shapes

面板、小型控制項、編輯區與膠囊標籤的圓角見 frontmatter。使用者訊息保留 16px／16px／4px／16px 的既有泡泡形狀。新功能沿用相同按鈕、標籤、欄位及細框語彙；附件移除按鈕為圓形，不把此例外推廣成所有按鈕的形狀。

## Components

- 工具列控制項：同一套高度 `--ctl-h`（滑鼠 32px，觸控裝置 44px）、8px 圓角、平常沒有框也沒有底色；滑過和選取時才出現次表面底色。分段切換（`.seg`）、一般控制（`.ctl`）、成員頭像與圖示按鈕都對齊這個高度；不用系統下拉選單。
- 狀態：頂部只有一個「點＋字」的狀態，不用實心膠囊。正常時是灰點；同步中是藍點；離線或連不上本機 Tandem 是警告色；失敗或衝突是錯誤色。連不上本機時以它為準，不同時顯示「已同步」。
- 色彩用量：藍色是唯一強調色，用在選取、主要連結、「等你」和已開 PR；黃色、綠色、紅色只留給真的需要注意的狀態（例如被卡住、同步失敗）。完成用灰色。
- 圖示：統一用 `components/icons.tsx` 和任務板內的 16px 線條 SVG（1.5px 線寬、圓角端點），不用 Unicode 符號當圖示。
- 看板分頁（2026-11-18 從三版中選定第 3 版）：頂部列下面一排三個等寬分頁「任務／隊友／決定」（`Tabs.tsx`）：次表面底的軌道（12px 圓角），選中的分頁高一階、字加粗到 600（淺色是白底加低陰影，深色是比軌道亮一階的灰、不加陰影），14px 字、高度 36px（觸控 44px）。只有「任務」帶數字：在等你的件數，藍底膠囊；隊友的狀態寫了「卡在」時，「隊友」旁邊一個 6px 錯誤色小點，不放數字。打開時停在「任務」。分頁是 tablist，左右鍵、Home、End 可以切換。脈絡、Agent 問答、對話與交接、房間、成員與邀請放在 ⋯ 選單。
- 任務分頁：只有一欄，由上往下是「在等你」（有才出現）、「你負責的」（還沒完成的）、「隊友負責的」（還沒完成、不是你負責的；你負責的和在等你都是空的時候才預設展開）、「最近完成」（收起來）。沒有工具列、篩選或檢視切換；寬螢幕也不分欄。看板上不開任務：任務由各自的 AI 用 `tandem_task` 開，或直接在 GitHub 開 issue。
- 任務板分組：分組標題是一行 13px 次文字（折疊箭頭、圖示、名稱、右邊計數），下面是這組的列，全部放在一塊 14px 圓角的表面色底裡（淺色是灰底上的白塊，深色是比背景亮一階的灰），列之間一條細線；不加框線或陰影。「在等你」整塊用淡藍底。沒有項目的分組收成一行灰字、不能展開，不畫底塊。
- 任務板列：一件事一行，48px 高：編號、標題（太長用 … 截斷，滑過看完整內容和說明）、右邊用字寫狀態：「待審查」（藍）、「進行中」、「草稿」、「卡住」（錯誤色）、「完成」「已合併」；任務有對應的 PR 時直接寫「PR #n」連結（PR 可以審查時是藍色）。「隊友負責的」和「最近完成」的列最右邊多負責人的 16px 頭像。「在等你」的列用淡藍底，右邊寫要你做什麼、誰在等（16px 頭像，側欄寬也看得到）、等多久。滑過時整條變次表面色。每組裡卡住的排最前面，再來是待審查、進行中；分組計數前寫「N 卡住」（錯誤色）。整條列的高度都能點。看板全空時留一行「還沒有任務。跟你的 AI 說要開什麼任務，或直接在 GitHub 開 issue。」
- 隊友分頁：最上面是「誰在等誰」（有才出現），下面一人一段，隊友在前、你在最後。每人一塊圓角底塊，跟分組同一種：28px 頭像、名字（15px、600）、你的後面一個藍色小字「你」、最右邊「N 小時前更新」（超過兩天用警告色，沒有狀態寫「還沒寫狀態」）；下一行是在做什麼（15px），再來是「卡在」（整行錯誤色）和「下一步」（13px 次文字），要大家知道的事前面一個線條圖釘；然後是他手上的任務、PR 和成品，一件一行，跟任務分頁用同一個列元件和同一份資料，從名字底下開始；最近動態收在一行可展開的小字。名字是 h3，螢幕閱讀器可以一人一人跳。狀態檔格式壞掉時右邊寫「狀態檔格式要修正」（警告色），不寫「還沒寫狀態」。你自己還沒寫狀態時多一行「跟你的 AI 說「更新我的狀態」。」只有你一個人時，最下面一行「還沒有隊友。」加「邀請隊友」連結，按了打開成員與邀請。
- 返回列：從 ⋯ 進去的每一頁（脈絡、Agent 問答、對話與交接、房間）第一列都是同一個 `PageBar`：左邊「‹ 任務」——寫的是你剛才所在的分頁，按了回到那個分頁（13px 次文字色、旋轉的 chevron、高度 `--ctl-h`，滑過才有次表面底色），後面接頁面標題（h2、15px、600，跟正文同級，不另做大標題），頁面自己的操作靠右。頁面不放說明句。打開頁面時焦點移到頁面標題，按返回時焦點回到原本的分頁。再往下一層（例如房間裡、脈絡的單一檔案）返回列寫上一層的名稱（「‹ 房間」「‹ 脈絡」）。「看板」這個名字只寫在 `PageBar.tsx` 的 `HOME`，用在載入和錯誤訊息。
- 列的行為要看得出來：標題是連結的列（開 GitHub 新分頁）滑過時右邊出現一個「往外」小圖示、標題加底線；在原地展開的列（例如決定）開頭有折疊箭頭。滑過效果只給有滑鼠的裝置，觸控不會留下底線或底色。
- 決定分頁：兩組，「決定」和「討論和問題」，已結束和更早的收在折疊組。討論在等人回答時，右邊寫「等」加那個人的 16px 頭像。「誰在等誰」放在隊友分頁：右邊是 16px 頭像「等的人 → 被等的人」和等了多久，側欄寬也看得到是誰；等你的列用跟「在等你」一樣的淡藍底。決定的「不能違反」用加粗正文色，不用紅色；紅色只留給出問題。展開的決定裡，原話是左邊一條細線的引文，不加底色。
- Agent 問答、對話與交接：內容用跟看板一樣的分組標題列（折疊箭頭、名稱、右邊計數或狀態），展開的內容放在同一種圓角底塊裡，不用大標題。紀錄在前、設定在後：Agent 問答先是「問答紀錄」，再是收起來的「我的回答設定」；對話與交接依序是「已分享的對話」「交接任務」「最近的交接」「我的對話分享」。回答和對話內容是左邊一條細線的引文，不加底色。
- 紀錄格式問題：在三個分頁的最下面顯示一行可展開的小字（「N 筆紀錄的格式要修正，點開看」），⋯ 進去的頁不顯示。
- 房間：從 ⋯ 選單進入，一欄。清單頁和看板一樣分組（進行中、最近結束），一個房間一行。房間頁由上到下是返回列（「‹ 房間」、房間標題和主持人的操作）、誰主持的一行小字、可收合的「筆記」、對話紀錄、固定在底部的輸入區。對話是紀錄而不是泡泡：名字和時間一行（16px 頭像），下一行是內容；AI 的名字用強調色；有人按「問 AI」的訊息標一個藍色小字「問 AI」。輸入區有兩個按鈕：「送出」（只給大家看）和主要按鈕「問 AI」（AI 會看上次回答之後的討論再回答）；Enter 送出、Ctrl+Enter 問 AI，觸控裝置上兩個按鈕各佔一半、高 44px。
- 看板載入錯誤：看板已經顯示時，錯誤是分頁下面的一行「紅點＋資料沒有更新：原因＋再試一次」，跟頂部狀態同一種寫法，不用色塊橫幅；放在分頁下面，出現和消失時分頁不會跳。
- 按鈕：主要操作為藍色，次要為有框表面，安靜操作為透明底與次文字色；停止使用既有危險操作樣式。一般高度至少 34px，輸入區操作與圖片操作至少 44px；disabled 降低不透明度至 0.55。
- 欄位：模型與 effort 使用既有有框 select，模型切換或工作中停用。一般鍵盤焦點為 3px 外框、2px 位移；編輯區聚焦改由整組 2px 外框、1px 位移標示，不重複描繪 textarea 外框。
- 導覽：三個分頁保留次表面容器與選取表面的低陰影；760px 以下整列等分。未新增全站入口。
- 面板與標籤：面板以細框與既有低陰影區分；狀態標籤以語意背景、文字及膠囊形狀呈現，不只依賴顏色傳達狀態。
- 訊息：使用者訊息靠右，AI 與工具內容靠左；核准卡明確區分等待、允許與拒絕。
- 模型：只列實際工具回報的選項；模型、effort、執行狀態需可辨識。
- 附件與草稿：草稿縮圖為 112px 寬、圖片區 84px 高，以 contain 保留內容；使用者訊息圖片為 220px 寬、160px 高。縮圖可開啟預覽對話框；移除按鈕只出現在可編輯附件，觸控目標為 44px。圖片名稱省略顯示但保留完整 title。草稿依載入、儲存、已保留及異常顯示文字，不把失敗顯示為已保存。
- Steer／queue：工作中在能力支援時顯示藍色「立即補充」、次要「排入下一則」與危險樣式「停止」；只有 queue 時以「排入下一則」為主要操作並顯示說明。佇列支援編輯、移除與暫停後繼續，桌面最多高 150px。不可把等待中的訊息顯示為 agent 已收到的 steer。provider 選項及圖片能力依實際 metadata，畫面文件不保證個別帳號可用。

## Do's and Don'ts

- Do 沿用現有色彩變數、元件與導覽，讓新功能容易找到。
- Do 對 loading、running、queued、failed 與 disabled 提供可辨識狀態。
- Do 保留繁中可讀性、鍵盤操作與手機上的觸控目標。
- Don't 給分組加框線或陰影；分組靠圓角底塊和分組之間的留白，層次靠字級和字重。
- Don't 給分組標題或中文加字距。
- Don't 在看板列上加第二行說明；細節放在滑過的提示和連結的頁面。
- Don't 寫重述名稱的說明句：標題下、選單項目下、頁面開頭都不放（例如「背景、規格和圖，大家都讀得到」「分享自己選定的專案對話…」）。文字只寫使用者看不出來的事：狀態、數量、後果或下一步；一頁要靠說明才看得懂，就改名稱或排法。
- Don't 以圖片取代實際介面的文字、按鈕或輸入欄位。
