# Tandem（暫定名稱）

給「各自用自己 AI agent」的人，一起做專案時共享決定和脈絡。

我們兩個各自做事都很快，一起做卻常常在等：等對方做決定、等對方把想法整理成文件、等文件傳過來才發現少了東西。Tandem 想讓每個人的 agent 直接讀到其他人做過的決定和說過的原話，不用等人轉述。

目前是**人工版**：沒有程式，只有一份給 agent 的規則（`AGENTS.md`）和 Markdown 紀錄。我們用它來開發 Tandem 本身。

## 怎麼開始

1. clone 這個 repo。
2. 在這個資料夾打開你的 agent（Claude Code、Codex 都可以），跟它說「開工」。
   它會照 `AGENTS.md` 讀其他人的狀態、告訴你上次之後有什麼跟你有關的變動。
3. 平常照常跟你的 agent 討論和做事。做了決定、有問題要問別人、或意見不同時，agent 會記下來。

## 結構

| 位置 | 放什麼 |
|---|---|
| `AGENTS.md` | 給 agent 的規則（`CLAUDE.md` 只引用它） |
| `records/decisions/` | 決定，附原話和是誰說的 |
| `records/questions/` | 等別人回答的問題 |
| `records/disagreements/` | 意見不同時，雙方的立場 |
| `team/status/<帳號>.md` | 每個人現在在做什麼、在等什麼、成品連結 |
| `notes/friction/` | 卡住的真實經驗，我們的使用者研究 |
