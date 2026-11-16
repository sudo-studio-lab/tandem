# Tandem 產品規範

<!-- impeccable:product-schema 1 -->

## Platform

web

介面由 React 網頁實作，亦供 Windows Electron 桌面 App 使用；手機瀏覽器仍是同一套網頁介面。

## Users

像 Roy 與 Jielle 這樣、各自使用自己的 AI 協作的小團隊。主要工作是共同推進專案，避免成員之間反覆傳話、重複說明及交接時流失脈絡。

Roy 於本次初始化確認此定位：「符合 先做參考圖」。

## Product Purpose

讓成員各用自己的 AI，共享團隊決定與進度，減少交接流失。使用者應能知道專案目前的情況、誰在等待自己，以及需要自己決定的事。

## Positioning

團隊紀錄與各自的 AI 工具連接：每人仍使用自己的 Claude Code 或 Codex，透過共同紀錄取得決定與工作狀態，而非由人反覆整理文件轉交。

## Operating Context

- 現有 prototype 有看板、個人 AI 對話、共用房間與多專案切換。
- 同時支援本機網頁、Windows 桌面 App，以及從終端機使用原本的 agent。
- 團隊共用紀錄以 GitHub repo 和 Discussions／Issues 為基礎；個人 AI 對話保留於本機。
- 目前以使用者已熟悉 GitHub 為 prototype 的工作假設；不熟 GitHub 的人如何上手仍未定案。

## Capabilities and Constraints

- 必須逐字保存人的決定原話，不能用 agent 改寫的摘要冒充原話。
- Tandem 不收集 AI 帳號憑證；現有轉接器透過使用者安裝的原版工具處理認證。
- 本次已授權需求：對話模型選擇、在對話貼上圖片、離開頁面返回後恢復輸入草稿，以及移除終端機入口下的「Tandem 的工具一樣能用」。已有本機實作與模擬驗證；尚未替換已安裝的桌面 App 或發布，不能當成已完成真實模型驗收。
- 本次追加 steer／queue：工作中可補充當前回合的指示，或將訊息排到後續回合；模型轉接器不支援的能力必須如實標示，不能把排隊當成當前回合的 steer。
- 本次追加 Antigravity、Grok、Cursor 原廠 ACP provider，並在對話中直接顯示使用者圖片與原廠傳來的原生圖片區塊。認證、能力查詢與實際推論分開驗證；本機 Antigravity 仍需原廠登入。
- 實際可用模型與 effort 取決於使用者的工具、帳號和模型清單，不捏造可用性。
- 訊息、附件和草稿須依對話隔離；尚未送出的內容不能因切換頁面而遺失。
- Prototype 的正式對外名稱、共用房間規則與派工核准方式仍有未定事項；不得以本文件替團隊定案。

## Brand Commitments

- 目前產品名稱為 Tandem；正式對外名稱未定。
- 本次產品工作使用繁體中文，操作文案直接描述行動與狀態。

## Evidence on Hand

- `../../notes/why-and-ideas.md`：產品起點與 prototype 使用者假設。
- `../../notes/design.md`：現有架構、資料邊界、功能及未驗證事項；文件明示 prototype 不是共同定案。
- `src/App.tsx`、`src/components/Chat.tsx`、`src/components/Room.tsx`、`src/styles.css`：現有介面實作。
- 本次使用者明確確認的產品定位，以及四項對話改進需求。
- 本機測試與模擬管線不能代表實際帳號、模型或已安裝桌面 App 的驗收。

## Product Principles

1. 減少使用者傳話、重複輸入及整理脈絡的負擔。
2. 讓人能清楚辨認決定、進度、等待與未完成狀態。
3. 保留原話與資料來源，區分已查證事實、工作假設和未定事項。
4. 延續使用者自己的 AI 工具與帳號，維持團隊紀錄與個人對話的邊界。
