# 資料模型（001-core）

**格式**：照 spec-kit 的 data-model.md（實體、欄位、關係、驗證、狀態變化）。
每個設計標明參考來源（D-20261115-3d9）。標 **最終** 的是產品定案的格式；標 **暫時** 的之後可能換。

## 總覽：資料放在哪

| 資料 | 位置 | 誰寫 | 參考 |
|---|---|---|---|
| 決定 | `tandem/decisions/<id>-<slug>.md` | 做決定的人的 agent | ADR / MADR / log4brains |
| 狀態 | `tandem/status/<login>.md` | 只有本人的 agent | Changesets「一人一檔」 |
| 團隊偏好 | `tandem/team.md` | 任何人（走 PR） | AGENTS.md 的白話規則 |
| 討論（問題、分歧） | GitHub Discussions | 每個人用自己的帳號 | Rust RFC：討論在討論串，定案才寫檔 |
| 任務 | GitHub Issues | 任何人 | Backlog.md / GitHub |
| 成品 | PR、檔案、網址 | 任何人 | — |
| 本機狀態（上次看到哪） | `.git/tandem/state.json`，不進 repo | 本機的 tandem | git 自己的 hooks 也放在 `.git/` |

**索引不存檔，讀的時候算**（**最終**）：看板和 `tandem brief` 每次都從檔案和 GitHub 算出來，不維護 `INDEX.md`。共用的索引檔是最容易衝突的地方（參考 PEP 0、Backlog.md、Changesets「只有機器人寫彙總檔」）。

## 編號（**最終**）

- 格式：`<種類>-<YYYYMMDD>-<4 碼 base36>`，例如 `D-20261115-k3f9`。
- 為什麼是 4 碼 base36：同一天才可能撞號，可能組合約 168 萬，一天 30 筆的撞號機率約 0.03%。原本的 3 碼 hex 只有 4096 種，一天 30 筆約 10%（參考 Beads 的雜湊編號計算）。
- **不用流水號**（D-001、D-002）：兩個人同時新增一定撞號，log4brains 就是為此放棄流水號；adr-tools、MADR、PEP 都有這個問題。
- 檔名：`<id>-<英文 slug>.md`，例如 `D-20261115-k3f9-local-web-first.md`。檔名必須以 id 開頭（`tandem check` 檢查）。
- 萬一撞號：`tandem check --fix` 自動幫後來的那筆改號（參考 Backlog.md `doctor --fix`）。

## 實體 1：決定（Decision）

**原則：寫了就不改**（**最終**，參考 log4brains「ADR 不可變」、PEP「定案後是歷史文件」）。要推翻就新增一筆，只在新的那筆寫 `supersedes`，舊檔完全不動。
「已被取代」是讀的時候算出來的：有任何一筆的 `supersedes` 指向它，它就是已取代。這樣推翻決定只會新增一個檔，兩個人同時推翻也不會有文字衝突。

### 欄位

```yaml
---
id: D-20261115-k3f9          # 必填，等於檔名開頭
title: 先做本機網頁            # 必填
date: 2026-11-15             # 必填
deciders: [jielle2453]       # 必填，做決定的人（參考 MADR decision-makers）
consulted: [theroyatlas]     # 選填，有被詢問意見的人（MADR consulted）
area: 架構                    # 選填，自由文字
strength: preference         # 必填：hard | preference | hunch | one-off
source: chat                 # 必填：定案的地方。討論串或 PR 的網址；在自己 agent 對話中做的寫 chat
supersedes: []               # 選填，被這筆取代的決定 id
---
```

- `source`：參考 PEP 的 `Resolution:`（定案必須連到做出決定的那則發言）。放在 frontmatter，機器才能檢查。
- 拿掉原本的 `status` 欄位：改成讀的時候算（見上）。
- `owner` 改成 `deciders`：一個決定可能是好幾個人一起同意的。

### 內文

```markdown
## 原話

> 「……」 — @jielle2453（chat）
> 「……」 — @theroyatlas（https://github.com/…/discussions/12#discussioncomment-…）

## 決定

## 原因

## 考慮過的其他做法     ← 選填，參考 MADR「Considered Options」

## 適用範圍與什麼時候該重新檢視
```

### 驗證規則（`tandem check`，參考 PEP 的 check-peps.py）

1. 必填欄位都在，`strength` 是四種之一。
2. `id` 格式正確、全專案唯一、等於檔名開頭。
3. `supersedes` 指到的決定存在；同一筆被兩個決定取代時提出警告（代表兩個人可能意見不同）。
4. 「原話」區存在，每一則都有 `@帳號`。
5. 引用的人如果不是 `deciders` 裡唯一的那位（也就是引用別人），那一則必須附網址；否則必須標「轉述」。
6. 沒有原話時，內容必須是「無原話，由 @帳號 的 agent 整理」。

### 生命週期

```
（在對話或討論串裡定案）→ 寫檔 → 有效 →（被新決定 supersedes）→ 已取代
```

沒有「提案中」的決定檔：還沒定案的事放在討論串，定案才寫檔（參考 Rust RFC：被拒絕的提案不進 repo）。被否決的做法寫在新決定的「考慮過的其他做法」。

## 實體 2：狀態（Status）

**一人一檔，只有本人的 agent 寫**（**最終**，參考 Changesets 每人一個檔、沒人改別人的檔所以不會衝突）。整份覆寫。

```yaml
---
login: jielle2453
updated: 2026-11-15T14:30:00+08:00
doing: 寫 Tandem 核心的 spec
next: 開始實作 tandem brief
blocked: ""                       # 卡在哪；空字串代表沒卡
fyi:                              # 需要別人知道的（最多 3 則）
  - text: 決定直接做完整版再調整
    ref: D-20261115-5f1
deliverables:                     # 剛做出的成品（最多 5 個）
  - title: 核心 spec
    url: https://github.com/sudo-studio-lab/tandem/blob/main/specs/001-core/spec.md
---

（選填：自由文字，20 行以內）
```

- 欄位放在 frontmatter，看板才讀得到。
- 「在等誰」**不寫在這裡**：從討論串和任務算出來（見下），避免兩個地方不一致。
- 「剛完成的任務、合併的 PR」不寫：從 GitHub 算。`deliverables` 只放 GitHub 算不出來的成品（設計稿、部署網址、文件）。

## 實體 3：討論（Discussion）

放在 GitHub Discussions（**最終**；免費方案私人 repo 能不能用，見 spec 待釐清）。

| 項目 | 做法 |
|---|---|
| 分類 | 用 GitHub 開啟 Discussions 時內建的「Q&A」分類（可以標記答案）。GitHub 沒有建立分類的 API，用內建分類就不需要人手動去建 |
| 種類 | 標籤 `tandem:question`、`tandem:disagreement` |
| 在等誰 | 內文第一行 `等：@theroyatlas`。被 @ 的人會收到通知 |
| 什麼時候算回應了 | 被等的人留言、或討論被標記答案、或討論關閉 |
| 結束 | 定案時寫一筆決定，`source` 填討論串網址；在討論串留一則連到決定的留言，然後關閉 |
| 分歧 | 每個人在討論串用自己的帳號寫立場，沒人能改別人的話；定案寫決定，`consulted` 列出雙方 |

Discussions 沒有「指派」功能，所以用 @ 加標籤代替。repo 沒開 Discussions 時（**暫時**）：改用 Issues 加同樣的標籤，看板分開顯示，不和任務混在一起。

## 實體 4：任務（Task）

GitHub Issues（**最終**）。

- 指派：Issue 的 assignee。
- 成品：連到這個 issue 的 PR（`Closes #n`）；其他成品寫在 issue 留言或狀態檔的 `deliverables`。
- 卡住：GitHub 的 issue 依賴（blocked by）。
- 標籤 `tandem:task` 只用來區分由 Tandem 建的任務，看板也顯示沒有標籤的 issue。

## 推導出來的資料（讀的時候算，不存檔）

### 誰在等誰

| 來源 | 規則 |
|---|---|
| 討論 | 開著、有 `等：@X` 且 X 還沒回應 → 作者在等 X |
| PR | 請 X 審查、X 還沒審 → 作者在等 X |
| 任務 | 被另一個開著的 issue 擋住 → 負責人在等那個 issue 的負責人 |

### 變動摘要（`tandem brief`）

- 比較範圍：`.git/tandem/state.json` 記的「上次報告到的 commit 和時間」到現在。
- 內容：新決定（尤其 `area` 和這個人有關、或原話 @ 到他的）、新的或有回應的討論（等他的優先）、指派給他的任務、別人狀態的 `fyi` 和 `blocked`。
- 報告完更新 `state.json`，同一批變動不重複報告。
- 什麼算「跟他有關」由 agent 判斷，tandem 只提供候選和原因（D-20261115-4b8：結構固定、判斷交給 AI）。

## 團隊偏好：`tandem/team.md`（**最終**）

白話寫這個團隊的習慣，例如「設計相關的決定都要問 @jielle2453」「黑客松期間不用開討論，直接記決定」。agent 開工時讀。沒有固定格式。

## 和現在 repo 的差別（遷移）

目前 `records/`、`team/` 是人工版，實作 `tandem init` 後搬到 `tandem/`：
- `records/decisions/*` → `tandem/decisions/`，編號補成 4 碼、`owner` 改 `deciders`、拿掉 `status`、加 `source: chat`。
- `records/questions/*` → 開成 Discussions。
- `team/status/*` → `tandem/status/`，改成新欄位。
- `notes/friction/` 留在原處（是我們的研究，不是產品資料）。
