# Tandem（暫定名稱）

給「各自用自己 AI agent」的小團隊，一起做專案時共享決定和進度。

每個人照常用自己的 Claude Code 或 Codex 工作；agent 會把會影響別人的決定、問題和狀態記到這個 repo，隊友的 agent 開工時就會主動告訴他跟他有關的變動。桌面 App 讓人一眼看到大家在做什麼、在 App 裡直接跟自己的 AI 對話，也能開一個大家一起跟 AI 討論的房間。

**現在是 prototype（0.2.x）。** 做法都還沒定案，等兩個人都試過再一起決定。

## 先讀

| 文件 | 內容 |
|---|---|
| [`notes/why-and-ideas.md`](notes/why-and-ideas.md) | 為什麼要做、痛點、想過哪些做法 |
| [`notes/research.md`](notes/research.md) | 參考過的產品和做法 |
| [`notes/design.md`](notes/design.md) | 現在的架構和流程、待解問題 |
| [`specs/`](specs/) | 每個功能做了什麼、怎麼做、為什麼（001 核心、002 桌面版、003 agent 和房間），加上資料格式和指令說明。是紀錄，不是定案 |

## 安裝

到 [tandem-releases](https://github.com/sudo-studio-lab/tandem-releases/releases/latest) 下載 Windows 安裝檔。之後會自動更新。

## 開發

```
npm install
npm run build
cd apps/cli && npm link
```

- 測試：`npm test`
- 只跑網頁介面（假資料）：`TANDEM_MOCK=1 npm run dev -w @tandem/web`
- 發行：`npm run release -- <版本> "<這版改了什麼>"`，GitHub Actions 會打包並上傳

## 結構

| 位置 | 放什麼 |
|---|---|
| `apps/cli` | `tandem` 指令、MCP 工具、hooks、本機服務（看板、AI 對話、房間） |
| `apps/web` | 網頁介面 |
| `apps/desktop` | 桌面 App（Electron） |
| `packages/core` | 共用核心：紀錄、git 同步、GitHub、開工報告 |
| `packages/contracts` | 共用的資料格式 |
| `tandem/` | 這個團隊自己的紀錄：決定、每個人的狀態、團隊習慣 |
| `notes/` | 背景文件 |
| `specs/` | 功能紀錄、資料格式、指令說明 |
