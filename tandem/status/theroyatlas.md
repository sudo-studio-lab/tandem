---
login: theroyatlas
updated: 2026-11-17T14:27:42+08:00
doing: "#10（對話換模型、圖片、草稿、steer／queue、三家 ACP provider）已合併並發佈 0.2.2；實測 tandem MCP 在 Claude Code、Codex、Cursor、Antigravity 都接得上。"
next: 兩邊重開 App 確認自動更新到 0.2.2；討論 tandem init 要不要多寫幾家的 MCP 設定。
blocked: ""
fyi:
  - text: 現階段 PR 不用等對方審，可以直接合併（D-20261117-cb6g）
  - text: 接 MCP 的實測：Cursor 要放 .cursor/mcp.json 並核准一次；Antigravity 要改全域設定，T3 裡的 Antigravity 又讀另一份；終端機的 claude 第一次也要核准。Gemini CLI、Grok 還沒接上。
deliverables:
  - title: Tandem 0.2.2
    url: https://github.com/sudo-studio-lab/tandem-releases/releases/tag/v0.2.2
  - title: "#10 對話控制與三家 ACP provider"
    url: https://github.com/sudo-studio-lab/tandem/pull/10
---
