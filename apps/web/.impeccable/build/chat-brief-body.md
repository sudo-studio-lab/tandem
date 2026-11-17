# Tandem 對話輸入功能擴充

Mode: Operate。使用者沿用現有風格並選定 A；這是既有對話的局部擴充，沒有更換全站品牌或建立全新畫面。

Approved comp: `.impeccable/mocks/chat-a.png`。原話第一行為「A 」，其後追加 Antigravity／Grok／Cursor provider 與在對話中顯示圖片。

Scope: 模型與 effort 選擇、貼圖與對話圖片放大、每段對話的持久草稿、steer 與可編輯／移除／暫停的 queue、三家 ACP provider；移除終端機入口下方指定文案。

## Direction contract

THESIS: 把輸入、附件、模型與工作中補充安排在同一個輸入區，讓使用者少切頁、少重打，區分當前回合與後續工作。

OWN-WORLD: 沿用既有灰白表面、藍色操作、系統中文字體、12px 面板圓角與原有三個分頁。所有新的控制項使用現有元件語彙。

STORY: 使用者先選模型，再輸入或貼圖。工作中可立即補充（provider 確實支援時），也能排到下一則；尚未送出的訊息與圖片在離頁後仍保留。

FIRST VIEWPORT: 左側對話清單、右側對話面板；上方保留標題與刪除，訊息區下方依序是模型／effort 與草稿狀態、待處理訊息列、圖片預覽與文字欄、附件與送出／立即補充／排隊／停止。窄螢幕換行或單欄，操作不可裁切。

FORM: Local extension of the existing conversation. Seed: N/A; new-work explicitly excludes local extensions from concept-seed. User selected comp A from three presented options. The generated thumbnail is illustrative; real user images are rendered directly. Generated Chinese text mistakes are corrected in semantic UI.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Evidence limits

Screenshots use explicitly labelled MOCK data. Clipboard browser checks synthesize ClipboardEvent; 390px is an emulated viewport, not a physical phone. ACP metadata/auth probes send no model prompts. Antigravity currently requires its own login. Native steer is implemented for Codex; other providers queue until the next turn.
