# 資料模型

> **這是紀錄，不是定案。** 以 0.2.1 的程式碼為準（`packages/contracts/src/index.ts`、`packages/core/src/records/`、`packages/core/src/github/`、`packages/core/src/state/`）。為什麼這樣設計，見 [001-core.md](001-core.md) 的〈技術選擇和原因〉。

## 資料放在哪、誰寫

| 資料 | 位置 | 誰寫 |
|---|---|---|
| 決定 | `tandem/decisions/<id>-<slug>.md` | 做決定的人的 agent（`tandem decide`）；`tandem check --fix` 會改撞號的檔名 |
| 狀態 | `tandem/status/<帳號>.md` | 只有本人的 agent（`tandem status`） |
| 團隊習慣 | `tandem/team.md` | `tandem init` 建立範本，之後任何人手動改 |
| 問題、分歧 | GitHub Discussions（沒開時改用 Issues） | 每個人用自己的 GitHub 帳號 |
| 任務 | GitHub Issues | 任何人 |
| 成品 | PR、網址、檔案；或狀態檔的 `deliverables` | 任何人 |
| 房間 | GitHub Discussions（帶房間標記） | 主持人（003） |
| 本機狀態 | `.git/tandem/`，不進 repo | 這台電腦上的 tandem |
| app 狀態 | `%APPDATA%\Tandem\app.json` 等 | 這台電腦上的 tandem（002） |

**紀錄的正本在遠端預設分支。** `tandem/` 底下的檔案，讀的時候讀 `origin/<預設分支>` 上的版本，再疊上本機還沒送出的寫入（待送區）。寫入也直接推到預設分支，不經過使用者目前的分支和工作目錄。工作目錄裡看到的 `tandem/` 只是使用者分支上的副本；手動改的檔案要進了預設分支才算數。

**沒有索引檔。** 看板、brief、「已取代」、「誰在等誰」都在讀的時候現算，不存檔。

## 編號

- 格式：`D-YYYYMMDD-xxxx`，`xxxx` 是 4 碼小寫英數亂數（0–9、a–z），日期用建立時的本機日期。例如 `D-20260101-ab12`。
- 產生時會避開目前已有的編號。
- 為什麼：同一天才可能撞號，約 168 萬種組合，一天 30 筆的撞號機率約萬分之三。不用流水號，因為兩個人同時新增一定撞號。
- 檔名：`<id>-<slug>.md`。slug 是英文小寫加連字號，沒給就從標題轉；標題轉不出英文（例如全中文）時用 `decision`。檔名必須以編號開頭。
- 真的撞號：`tandem check` 報錯；`tandem check --fix` 依檔名排序，保留第一筆，其他的換新編號（同一天）並改檔名，在同一個 commit 裡刪舊加新。

## 決定

### 欄位（frontmatter）

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | 是 | 編號，必須和檔名開頭一致 |
| `title` | 是 | 標題 |
| `date` | 是 | `YYYY-MM-DD`；沒給就是今天 |
| `deciders` | 是 | 做決定的人的 GitHub 帳號，至少一個；`tandem decide` 沒給時用自己 |
| `consulted` | 否 | 決定前問過意見的人；空的就不寫出來 |
| `area` | 否 | 自由文字，例如「架構」 |
| `strength` | 是 | `hard`（不能違反）、`preference`（有理由的偏好）、`hunch`（直覺）、`one-off`（只限這次） |
| `source` | 是 | 定案的地方：`chat`（在自己 agent 的對話裡）或網址 |
| `supersedes` | 否 | 這筆取代的舊決定編號清單；空的就不寫出來 |

沒有 `status` 欄位：「已取代」是讀的時候算的（見〈生命週期〉）。

### 內文段落

依序是：

1. `## 原話`（必填）
2. `## 決定`（必填）
3. `## 原因`（必填）
4. `## 考慮過的其他做法`（選填）
5. `## 適用範圍與什麼時候該重新檢視`（選填）

其他標題會被當成「不認得的段落」，只是警告。

**原話的寫法**：每則一段引用：

```markdown
> 「逐字原話」 — @jielle2453（chat）

> 「逐字原話」 — @theroyatlas（https://github.com/…/discussions/12#discussioncomment-…）

> 「逐字原話」 — @jielle2453 轉述 @theroyatlas（chat）
```

- 原話只能放人實際說過的話：逐字，不改寫、不摘要、不翻譯。
- 出處是 `chat` 或網址。
- 「轉述」：沒有第一手出處、由某人轉達的話，寫成「@轉述的人 轉述 @說話的人」。
- 沒有原話時，整段必須剛好是：`無原話，由 @帳號 的 agent 整理。` 讓讀的人知道這筆是 agent 整理的，比較不可靠。

### `tandem decide` 的輸入

JSON 欄位和 frontmatter 對應，另外有：`slug`、`quotes`（每則 `by`、`text`、`source`，選填 `relayedBy`）、`noQuoteBy`（沒有原話時，由誰的 agent 整理）、`decision`、`why`、`optionsConsidered`、`scope`。完整格式見 [contracts/cli.md](contracts/cli.md)。

### 驗證規則（`tandem check` 和 `tandem decide` 共用）

錯誤：
1. frontmatter 存在且是合法 YAML；必填欄位都在，格式正確（編號、日期、帳號、`strength` 四選一、`source` 是 `chat` 或網址）。
2. 檔名是 `<id>-<名稱>.md`。
3. 三個必填段落都在且不是空的。
4. 原話區不是空的；每則原話都是上面的引用格式，有 @帳號和出處。
5. 引用的人不在 `deciders` 裡時，出處必須是網址，或標成轉述。
6. 沒有原話時，句子必須剛好是「無原話，由 @帳號 的 agent 整理。」
7. 決定不能取代自己；`supersedes` 指到的決定必須存在。
8. 全專案編號不重複（可用 `--fix` 修）。

警告（不擋寫入）：
- 同一筆決定同時被兩筆新決定取代——兩個人可能意見不同。
- 不認得的段落。

### 生命週期

```
（在對話或討論串裡定案）→ 寫檔 → 有效 →（有別的決定 supersedes 它）→ 已取代
```

- **寫了就不改。** 要推翻就新增一筆，在新的那筆寫 `supersedes`，舊檔完全不動。
- **「已取代」讀的時候算**：任何一筆的 `supersedes` 指向它，它就是已取代（讀進來時放在 `supersededBy`）。這樣推翻決定只會新增檔案，兩個人同時推翻也不會有文字衝突。
- 沒有「提案中」的決定檔：還沒定案的事放討論串，定案才寫檔；被否決的做法寫在「考慮過的其他做法」。
- 寫入時用「只能新建」的方式：遠端已有同名但內容不同的檔案，這筆寫入不會送出，被放到 `.git/tandem/conflicts/`。

## 狀態

一人一檔，只有本人的 agent 寫，每次整份重寫。

```yaml
---
login: jielle2453
updated: 2026-11-15T14:30:00+08:00
doing: 寫資料模型
next: 開始寫指令說明
blocked: ""
fyi:
  - text: 決定改成直接寫預設分支
    ref: D-20260101-ab12
deliverables:
  - title: 資料模型
    url: https://github.com/…
---

（選填：自由文字）
```

| 欄位 | 說明 |
|---|---|
| `login` | 必填，必須和檔名一致 |
| `updated` | 必填，含時區的時間，寫入時自動填 |
| `doing`、`next` | 在做什麼、接下來做什麼；預設空字串 |
| `blocked` | 卡在哪；空字串代表沒卡 |
| `fyi` | 要大家知道的，最多 3 則，每則 `text`，選填 `ref`（決定編號、網址等） |
| `deliverables` | 成品，最多 5 個，每個 `title` 和 `url`（必須是網址） |
| 內文 | 自由文字（`notes`） |

- 更新時只覆蓋這次有給的欄位，其他保留原值；`fyi`、`deliverables` 有給就整串換掉。
- 只能寫自己的檔：檔名固定是自己的帳號，原本的檔案屬於別人時拒絕。原檔壞掉讀不懂時，整份重寫並警告。
- 「在等誰」**不寫在這裡**，從討論、PR、issue 算。合併的 PR、關掉的任務也不寫，從 GitHub 算；`deliverables` 只放 GitHub 算不出來的成品（設計稿、部署網址、文件）。

## 討論：問題和分歧

| 項目 | 做法 |
|---|---|
| 位置 | GitHub Discussions 的 Q&A 分類（slug `q-a`，沒有就找任何可以標記答案的分類） |
| 種類 | 標籤 `tandem:question`、`tandem:disagreement`；沒標籤的討論算「其他」 |
| 在等誰 | 內文第一行 `等：@帳號 @帳號`（全形或半形冒號都可以）。被 @ 的人會收到 GitHub 通知 |
| 什麼時候不算在等 | 討論關閉、被標記答案、或被等的人留過言 |
| 結束 | `tandem resolve`：可以先留一則「已定案，見決定 …」的留言，再關閉（原因：resolved／outdated／duplicate）。產生的決定 `source` 填討論串網址 |
| 分歧 | 發起人寫自己的立場，對方用自己的帳號在討論串回覆；沒人能改別人的話。定案的決定用 `consulted` 列出雙方 |

Discussions 沒有「指派」，所以用第一行的 @ 加標籤代替。

**沒開 Discussions 時**：`tandem ask`、`tandem disagree` 改開一個 issue，內文同樣有 `等：` 那一行、同樣的標籤。（限制：這種 issue 不算進「誰在等誰」，也不能用 `tandem resolve` 關閉。）

`tandem init` 會建立三個標籤：`tandem:question`、`tandem:disagreement`、`tandem:task`。

## 任務

GitHub Issues。

- 指派：issue 的 assignee。`tandem task` 建立的會加 `tandem:task` 標籤，但看板也顯示沒有標籤的 issue（PR 除外）。
- 卡住：GitHub 的 issue 依賴（blocked by），只算還開著的擋路 issue。
- 成品：連到這個 issue 的 PR，或寫在 issue 留言、狀態檔的 `deliverables`。

## 房間（003）

房間也是一則 Discussion（放在 General 這類不能標記答案的分類），內文開頭有標記 `<!-- tandem-room v1 host=<主持人帳號> -->`。帶這個標記的討論不會出現在一般的討論列表和「誰在等誰」裡。細節見 003。

## 推導出來的資料（讀的時候算，不存檔）

### 誰在等誰

| 來源 | 規則 | 誰在等誰 |
|---|---|---|
| 討論 | 開著、沒有答案、第一行有 `等：@X`、X 還沒留言、X 不是作者 | 作者等 X |
| PR | 開著、不是草稿、有請 X 審查、X 不是作者 | 作者等 X |
| 任務 | 開著，被另一個開著的 issue 擋住 | 這個 issue 的負責人等擋路 issue 的負責人 |

帳號比對不分大小寫；相同的等待關係只算一次。

### 開工報告（brief）

- **比較範圍**：從上次報告時記下的「遠端預設分支 commit」到現在；沒有紀錄或那個 commit 已經不在歷史裡，就看最近 7 天。
- **內容**：
  - 在等我的、我在等的（見上表）。
  - 新決定：這段時間新增的決定檔，排除「做決定的人只有我」的；提到我（我在 `consulted`、原話是我說的、或內文有 `@我`）的排前面，再依強度排。
  - 指派給我、這段時間有更新的開著的 issue。
  - 隊友：狀態檔這段時間有變、或正卡住的人（在做什麼、卡在哪、要大家知道的）。
  - 紀錄問題：`tandem check` 的錯誤。
- 什麼都沒有時標成 `quiet`，報告只說「上次之後沒有跟你有關的變動」。
- 報告完把新的 commit 和時間記進本機狀態，同一批變動不重複報告（`--peek` 不記）。
- 「跟他有關」只做粗的篩選，細的判斷交給 agent。

## 團隊習慣：`tandem/team.md`

白話寫這個團隊的習慣，例如「設計相關的決定都要問某人」。沒有固定格式。`tandem init` 只在檔案不存在時建立範本。（目前沒有任何指令會自動把它放進 agent 的脈絡。）

## 本機狀態：`.git/tandem/`

放在 `.git/` 底下，不會被提交，每份 clone 各自一份。

| 檔案 | 內容 |
|---|---|
| `state.json` | `version: 1`；`login`（目前的 GitHub 帳號）；`lastBrief`（上次報告到的 `commit` 和 `time`）；`etags`（GitHub 回應的快取）；`sessions`（hook 用：每個 agent session 開始的時間、commit、工作目錄指紋、是否提醒過、是否要重放報告，只留最近 20 個） |
| `outbox/` | 待送區：還沒推上去的寫入，一筆一個 JSON 檔（先寫暫存檔再改名） |
| `conflicts/` | 因同名檔案而沒送出的寫入 |
| `lock` | 跨行程的檔案鎖，同一時間只有一個行程在推紀錄 |
| `default-branch` | 遠端預設分支名稱的快取 |

`state.json` 壞掉時改名成 `state.json.bak`，從空白重來。

## app 狀態（002）

一台電腦一份，放在環境變數 `TANDEM_HOME` 指定的資料夾，否則 Windows 是 `%APPDATA%\Tandem\app.json`，其他系統是 `~/.config/tandem/app.json`。內容：已知的專案（`owner/name`、本機路徑、上次打開時間）、目前的專案、新專案預設下載到哪（`~/Tandem`）、通知設定、已經通知過的項目（最多 1000 筆）。`tandem init`、`tandem join` 和看板會把專案記進這裡。

GitHub 權杖不在這些檔案裡：存在作業系統的認證管理員（服務名稱 `Tandem`、帳號 `github`）。
