---
id: D-20261115-lwh7
title: 先補 agent：在桌面版裡直接用 AI，像 T3 Code 一樣可用訂閱或 API key
date: 2026-11-15
deciders: [jielle2453]
area: 規劃
strength: preference
source: chat
---

## 原話

> 「照你原本的spec也可以 只是現在要先補agent這件事」 — @jielle2453（chat）

> 「我要t3code那樣可以登入也可以用API」 — @jielle2453（chat）

## 決定

下一個 spec 是 003-agent：在桌面版裡直接跟自己的 AI 對話，Claude 和 Codex 都能用訂閱登入或 API key。先補 MCP 伺服器、引擎轉接和兩家 agent 的相容性測試。原本的房間、派工、團隊大腦順序不變，各往後一號。

## 原因

原本設計裡的 MCP 伺服器、引擎轉接和相容性測試沒做；現在只會打開終端機，使用者想在 app 裡直接用 AI。

## 考慮過的其他做法

Claude 只內嵌終端機（可用訂閱但不是對話框）；Claude 只用 API key（對話框但不能用訂閱）。照 Anthropic 規定，執行使用者自己裝的原版 Claude Code、由使用者用 Claude Code 自己的流程登入是允許的，所以兩種都做。不用 Agent SDK 搭配訂閱，也不在 Tandem 裡做自己的 Claude 登入、不經手 Claude 憑證。

## 適用範圍與什麼時候該重新檢視

003-agent 做完前有效；Anthropic 或 OpenAI 的規定改變時重新檢視。
