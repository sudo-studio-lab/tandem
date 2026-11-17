---
id: D-20261117-7m4b
title: 團隊資料改放私人 repo：程式、PR、任務留在公開 repo
date: 2026-11-17
deciders: [theroyatlas]
area: 資料存放
strength: preference
source: chat
---

## 原話

> 「A吧 然後直接幫我跟他講」 — @theroyatlas（chat）

> 「三個都同意 不用問jielle」 — @theroyatlas（chat）

## 決定

另開一個私人 repo 放團隊資料：共享脈絡（第 2 塊，包含決定）、agent 之間的訊息（第 4 塊）、每人狀態都放這裡。程式碼、PR、任務（issue）留在公開的 sudo-studio-lab/tandem。「資料放哪個 repo」做成可以設定：程式 repo 本來就是私人的團隊直接用同一個，只有開源專案才另開。已經公開的決定和狀態搬到私人 repo；不改寫公開 repo 的歷史、不 force push，就算搬走，舊內容還留在 git 歷史裡。這個專案的私人 repo 叫 sudo-studio-lab/tandem-data。搬完會在 PR 裡 @jielle2453。

## 原因

sudo-studio-lab/tandem 是公開的，照原本的做法，共享脈絡和 agent 之間的訊息都會公開。Cursor 也是程式和 PR 在 GitHub，脈絡、任務板、訊息放在自己的伺服器。

## 考慮過的其他做法

B 自己架後台；C 加密後放公開 repo

## 適用範圍與什麼時候該重新檢視

Tandem 的資料存放位置；第 2、4、5 塊照這個做。
