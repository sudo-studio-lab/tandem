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
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "15px"
    lineHeight: 1.55
  control:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "0.9rem"
    fontWeight: 500
  caption:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "0.85rem"
  panel:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "13px"
    lineHeight: 1.45
  group-label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.06em"
rounded:
  surface: "8px"
  small: "6px"
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
    rounded: "{rounded.surface}"
---

# Design System: Tandem

## Overview

記錄現有 prototype 的視覺系統，來源為 `src/styles.css`、`Chat.tsx`、`Composer.tsx` 與 `ChatImages.tsx`。已選定的 A 參考圖為 `.impeccable/mocks/chat-a.png`；完成畫面的桌面及手機截圖位於 `.impeccable/review/desktop.png`、`.impeccable/review/mobile.png`，使用明確標示的 MOCK 資料。截圖不代表真實 provider、正式環境或實體手機驗收。

介面以完成協作任務為目的：文字、訊息和操作為主，藍色表示主要操作與目前選擇。使用者本次沒有新增風格偏好，功能擴充沿用現有系統；三版參考圖比較新增控制項的安排，不改品牌。

**方向：像編輯器原本就有的面板**（2026-11-18 從三版中選定第 1 版）。Tandem 主要放在編輯器側欄，邊寫程式邊看；所以看板要安靜、資訊密、不搶寫程式的注意力。中性灰底、13px、一件事一行，顏色只留給「等你」和出問題。新的頁面先照這個方向，不另立風格。

**Key Characteristics:**
- 中性灰表面（不帶藍）、語意色彩及系統中文字體；深淺色跟著系統。
- 模型、草稿、待處理訊息及輸入操作集中於既有對話面板。
- 桌面並排、窄螢幕換行與單欄，圖片保留實際內容。

## Colors

淺色模式採中性淺灰底、深色文字與藍色操作色，值以 frontmatter 與 `src/styles.css` 為準。成功、警告與錯誤各有專用的背景和文字色。

深色模式依 `prefers-color-scheme: dark` 切換：背景 `#18191c`、表面 `#1e1f23`、次表面 `#26272b`、框線 `#2c2d32`、文字 `#d6d8dd`、次文字 `#8f939b`、操作色 `#6f9bff`、錯誤字 `#f08a7e`。灰色不帶藍，才像編輯器本身的面板。新增功能沿用語意變數，不寫死淺色值。次文字對背景至少 4.5:1。

## Typography

沿用系統 sans-serif 字體堆疊，中文以裝置上的繁中字體呈現。頂部列和看板用面板字級 13px（`panel`），分組標題用 11px、0.06em 字距、次文字色（`group-label`），編號和計數用等寬數字；長文和表單頁維持 15px 基準。基準與控制項、次要資訊尺寸見 frontmatter；頁面標題為 1.4rem，對話正文行高為 1.6。次要資訊使用較小字級與次文字色；指令和原始工具輸出使用 `ui-monospace, Consolas, monospace`。未建立新展示字體或 Google Fonts 配對。

## Layout

頂部只佔一行（40px，背景和頁面同色、底下一條細線）：產品標記、專案切換、一個安靜的狀態、成員頭像、⋯ 與設定；只有一個畫面時不顯示導覽。640px 以下藏起產品名稱、owner、正常狀態和頂部成員頭像（看板自己的工具列已有成員，成員與邀請留在 ⋯ 選單）。內容最大寬度為 1240px。桌面對話採 250px 左側清單與可伸縮右側對話區，欄距 16px；對話內由標題、可捲動訊息與底部輸入區組成。

輸入區採 A 的分組順序：模型／effort 與草稿狀態、待處理訊息、附件與文字編輯區、加入圖片與送出操作。桌面編輯區內縮圖和文字並排；輸入區最多佔對話高度 55%，內容過多時可捲動。

斷點為 900px（看板單欄）、760px（對話單欄與導覽整列）及 560px（頂欄與一般頁面縮減左右留白、表單單欄）。760px 以下附件改置文字上方，模型與 effort 換行，隱藏鍵盤提示，佇列取消固定最大高度；對話採頁面流動，訊息區最大高度 50dvh、最小高度 220px，輸入區不設最大高度。這是窄視窗適配，非實體裝置驗收。

## Elevation & Depth

淺色面板與目前選取的導覽使用既有細框與低陰影，彈出選單和對話框有較大陰影；深色模式的低陰影為 none。完整明暗陰影數值記於 `.impeccable/design.json`，來源是 CSS，不另造裝飾效果。

## Shapes

面板、小型控制項、編輯區與膠囊標籤的圓角見 frontmatter。使用者訊息保留 16px／16px／4px／16px 的既有泡泡形狀。新功能沿用相同按鈕、標籤、欄位及細框語彙；附件移除按鈕為圓形，不把此例外推廣成所有按鈕的形狀。

## Components

- 工具列控制項：同一套高度 `--ctl-h`（滑鼠 28px，觸控裝置 44px）、6px 圓角、平常沒有框也沒有底色；滑過和選取時才出現次表面底色。分段切換（`.seg`）、一般控制（`.ctl`）、成員頭像與圖示按鈕都對齊這個高度；不用系統下拉選單。
- 狀態：頂部只有一個「點＋字」的狀態，不用實心膠囊。正常時是灰點；同步中是藍點；離線或連不上本機 Tandem 是警告色；失敗或衝突是錯誤色。連不上本機時以它為準，不同時顯示「已同步」。
- 色彩用量：藍色是唯一強調色，用在選取、主要連結、「等你」和已開 PR；黃色、綠色、紅色只留給真的需要注意的狀態（例如被卡住、同步失敗）。完成用灰色。
- 圖示：統一用 `components/icons.tsx` 和任務板內的 16px 線條 SVG（1.5px 線寬、圓角端點），不用 Unicode 符號當圖示。
- 任務板分組：分組標題是一行小字（折疊箭頭、圖示、名稱、右邊計數），不是色塊或卡片。沒有項目的分組收成一行灰字、不能展開。
- 任務板列：一件事一行，至少 28px 高（觸控 44px）：編號、標題（太長用 … 截斷，滑過看完整內容和說明）、右邊是「卡住」「草稿」、相關 PR 和負責人的 16px 頭像。「等你」的列用淡藍底，右邊寫要你做什麼、誰在等、等多久。列從面板左緣延伸到右緣，滑過時整條變次表面色。每組裡卡住的排最前面，分組計數前寫「N 卡住」（錯誤色）。整條列的高度都能點。看板全空時留一行「還沒有任務。新增任務」。
- 成員狀態：在看板裡點成員頭像，狀態排在「等你」下面，用面板文字呈現（22px 頭像、13px 字、底下一條細線），不是卡片；釘選事項用線條圖示，不用 emoji。
- 房間：從 ⋯ 選單進入，一欄。清單頁和看板一樣分組（進行中、最近結束），一個房間一行。房間頁由上到下是「回房間」、標題和誰主持、可收合的「筆記」、對話紀錄、固定在底部的輸入區。對話是紀錄而不是泡泡：名字和時間一行（16px 頭像），下一行是內容；AI 的名字用強調色；有人按「問 AI」的訊息標一個藍色小字「問 AI」。輸入區有兩個按鈕：「送出」（只給大家看）和主要按鈕「問 AI」（AI 會看上次回答之後的討論再回答）；Enter 送出、Ctrl+Enter 問 AI，觸控裝置上兩個按鈕各佔一半、高 44px。
- 看板載入錯誤：看板已經顯示時，錯誤是一行「紅點＋文字＋再試一次」，跟頂部狀態同一種寫法，不用色塊橫幅。
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
- Don't 用卡片、色塊或粗框包分組；層次靠字級、字重和留白。
- Don't 在看板列上加第二行說明；細節放在滑過的提示和連結的頁面。
- Don't 以圖片取代實際介面的文字、按鈕或輸入欄位。
