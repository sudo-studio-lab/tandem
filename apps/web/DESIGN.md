---
name: Tandem
description: 現有協作工作介面的視覺規範，從 prototype 實作擷取
colors:
  background: "#f3f4f7"
  surface: "#ffffff"
  surface-secondary: "#f7f8fa"
  text: "#1a2130"
  muted: "#667085"
  border: "#e2e5ea"
  border-strong: "#cfd4dc"
  primary: "#2259d6"
  primary-soft: "#e8efff"
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
rounded:
  surface: "12px"
  small: "8px"
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

**Key Characteristics:**
- 灰白表面、語意色彩及系統中文字體。
- 模型、草稿、待處理訊息及輸入操作集中於既有對話面板。
- 桌面並排、窄螢幕換行與單欄，圖片保留實際內容。

## Colors

淺色模式採灰白底、深色文字與藍色操作色，值以 frontmatter 與 `src/styles.css` 為準。成功、警告與錯誤各有專用的背景和文字色。

現有深色模式依 `prefers-color-scheme: dark` 切換：背景 `#0f1318`、表面 `#181d25`、次表面 `#1e242e`、文字 `#e6eaf0`、次文字 `#97a3b6`、操作色 `#7aa7ff`。新增功能沿用語意變數，不寫死淺色值。

## Typography

沿用系統 sans-serif 字體堆疊，中文以裝置上的繁中字體呈現。基準與控制項、次要資訊尺寸見 frontmatter；頁面標題為 1.4rem，對話正文行高為 1.6。次要資訊使用較小字級與次文字色；指令和原始工具輸出使用 `ui-monospace, Consolas, monospace`。未建立新展示字體或 Google Fonts 配對。

## Layout

頂部只佔一行（48px）：產品標記、專案切換、一個安靜的狀態、成員頭像、⋯ 與設定；只有一個畫面時不顯示導覽。640px 以下藏起產品名稱、owner、正常狀態和頂部成員頭像（看板自己的工具列已有成員，成員與邀請留在 ⋯ 選單）。內容最大寬度為 1240px。桌面對話採 250px 左側清單與可伸縮右側對話區，欄距 16px；對話內由標題、可捲動訊息與底部輸入區組成。

輸入區採 A 的分組順序：模型／effort 與草稿狀態、待處理訊息、附件與文字編輯區、加入圖片與送出操作。桌面編輯區內縮圖和文字並排；輸入區最多佔對話高度 55%，內容過多時可捲動。

斷點為 900px（看板單欄）、760px（對話單欄與導覽整列）及 560px（頂欄與一般頁面縮減左右留白、表單單欄）。760px 以下附件改置文字上方，模型與 effort 換行，隱藏鍵盤提示，佇列取消固定最大高度；對話採頁面流動，訊息區最大高度 50dvh、最小高度 220px，輸入區不設最大高度。這是窄視窗適配，非實體裝置驗收。

## Elevation & Depth

淺色面板與目前選取的導覽使用既有細框與低陰影，彈出選單和對話框有較大陰影；深色模式的低陰影為 none。完整明暗陰影數值記於 `.impeccable/design.json`，來源是 CSS，不另造裝飾效果。

## Shapes

面板、小型控制項、編輯區與膠囊標籤的圓角見 frontmatter。使用者訊息保留 16px／16px／4px／16px 的既有泡泡形狀。新功能沿用相同按鈕、標籤、欄位及細框語彙；附件移除按鈕為圓形，不把此例外推廣成所有按鈕的形狀。

## Components

- 工具列控制項：同一套高度 `--ctl-h`（滑鼠 32px，觸控裝置 44px）、8px 圓角、同一種細框。分段切換（`.seg`）、一般控制（`.ctl`）、成員頭像與圖示按鈕都對齊這個高度；不用系統下拉選單。選取狀態是唯一用到強調色的地方。
- 狀態：頂部只有一個「點＋字」的狀態，不用實心膠囊。正常時是灰點；同步中是藍點；離線或連不上本機 Tandem 是警告色；失敗或衝突是錯誤色。連不上本機時以它為準，不同時顯示「已同步」。
- 色彩用量：藍色是唯一強調色，用在選取、主要連結、「等你」和已開 PR；黃色、綠色、紅色只留給真的需要注意的狀態（例如被卡住、同步失敗）。完成用灰色。
- 圖示：統一用 `components/icons.tsx` 和任務板內的 16px 線條 SVG（1.5px 線寬、圓角端點），不用 Unicode 符號當圖示。
- 任務板分組：沒有項目的分組收成一行灰字、不能展開；「等你」的列和其他列用同一個兩行結構（圖示、編號、標題；下一行是說明）。
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
- Don't 因這次對話功能擴充更換全站配色、字體、品牌或導覽結構。
- Don't 以圖片取代實際介面的文字、按鈕或輸入欄位。
