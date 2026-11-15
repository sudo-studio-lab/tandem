---
id: D-20261115-w7m2
title: 001 階段先借用使用者已經登入的 `gh` 來呼叫 GitHub
date: 2026-11-15
deciders: [jielle2453]
area: 架構
strength: one-off
source: chat
---

## 原話

> 「好 開 Discussions你可以自己用嗎 git 作者名稱就用我的用戶名」 — @jielle2453（chat）

## 決定

001 階段先借用使用者已經登入的 `gh` 來呼叫 GitHub，不註冊 Tandem 自己的 OAuth App。

## 原因

我們兩個都已經登入 `gh`，不用任何設定就能開始實作和測試。最終設計（自己的 OAuth App 加裝置碼登入）不變，見 specs/001-core/research.md R14。

## 適用範圍與什麼時候該重新檢視

只限 001 階段。要給沒裝 `gh` 的人測試前，改成自己的 OAuth App。

（編號已改用 data-model.md 的新格式：4 碼 base36。）
