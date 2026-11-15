# 紀錄格式

一筆紀錄一個檔。檔名是 `<編號>-<英文簡述>.md`。
編號是「種類-日期-三碼亂數」，例如 `D-20261115-a3f`，兩個人同時新增也不會撞號。
亂數可以用 `openssl rand -hex 2 | cut -c1-3` 產生，或隨便打三個 0–9、a–f 的字元。

| 種類 | 前綴 | 資料夾 |
|---|---|---|
| 決定 | `D` | `decisions/` |
| 問題 | `Q` | `questions/` |
| 分歧 | `DIS` | `disagreements/` |

舊紀錄不刪不改內容，只改 `status`。要推翻一個決定，就新增一筆並寫 `supersedes`，再把舊的改成 `superseded`。

## 決定

```markdown
---
id: D-YYYYMMDD-xxx
status: active          # active | superseded
area:                   # 例如：產品範圍、介面、紀錄格式
owner:                  # 做決定的人的 GitHub 帳號
strength: preference    # hard（不能違反）| preference（傾向）| hunch（直覺，隨時可改）| one-off（只限這次）
date: YYYY-MM-DD
supersedes:
---

## 原話

> 「……」 — @帳號（出處）

## 決定

一兩句。

## 原因

## 適用範圍與什麼時候該重新檢視
```

## 問題

```markdown
---
id: Q-YYYYMMDD-xxx
status: open            # open | answered
asked_by:
ask_to:                 # 要誰回答（可以多人）
needed_by:              # 什麼時候前需要答案，可空
date: YYYY-MM-DD
---

## 原話

## 問題

## 卡住什麼

沒有答案的話，什麼事做不下去。

## 回答

（回答的人寫原話；變成決定的話連到 D- 編號）
```

## 分歧

```markdown
---
id: DIS-YYYYMMDD-xxx
status: open            # open | decided
area:
people: []
decider:                # 誰決定，或用什麼方式決定；可空
date: YYYY-MM-DD
---

## 各方立場

### @帳號

> 原話

- 理由：
- 什麼情況下會改變想法：

### @帳號

> 原話

- 理由：
- 什麼情況下會改變想法：

## 結果

（決定後連到 D- 編號）
```
