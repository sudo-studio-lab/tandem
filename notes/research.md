# Tandem 的研究：參考過的產品和做法

這一部分整理 Tandem 成形前後看過的產品、開源專案、研究和做法：它們怎麼運作、我們拿了什麼、哪裡不適合。來源有三個：早期的發想對話、三份規格的研究紀錄（001 核心、002 桌面版、003 在 Tandem 裡用自己的 AI），以及 Roy 的 agent 寫的情境比較文件（下面標「Roy 的 agent 的文件」）。

**先看懂幾個詞**
- **agent**：會自己動手做事的 AI 助手，不只回答，還會讀檔、改檔、執行指令。例如 Claude Code、Codex。
- **MCP**：讓 agent 接外部工具或資料的開放標準。agent 是主動的一方，需要時「打電話」來查或寫。
- **SDK／協定**：讓別的程式「驅動」agent 的方式，例如啟動它、看它每一步、中途叫停。和 MCP 方向相反。
- **hook**：agent 在固定時間點（開始工作、每一輪前、結束前）自動執行的小程式。
- **skill**：寫成 Markdown 的「做事方法」，agent 需要時才載入。
- **repo／PR／issue**：GitHub 上的專案檔案庫／「改動請先看過再併進去」的申請／待辦卡。

---

## 一、朋友的雛形（早期構想，不整套照搬）

使用者明確說過：這兩個是朋友的初步構想，可以了解想法，但不要當成主要參考，比不上被很多人驗證過的 repo。

### Readback（theroyatlas，Roy 的作品）
- **是什麼**：一個「多人一起指揮同一個 agent」的雛形，名字來自航空用語的「複誦」。
- **怎麼做的**：每句話送出後 agent 先回一張**回條**（聽到什麼、屬於新增／修改／撤回／提問、何時生效）；重要的限制和決定**用原話釘在記憶板**上、標明誰說的、永遠不摘要、被取代也不刪；完成前拿成品**逐條對照記憶板**並附證據；換模型接手時要先**答對情境題**才算交棒成功；字數這類模型不擅長的事交給程式算。
- **我們拿了什麼**：「原話優先、不信任摘要」直接變成 Tandem 最重要的規則（決定的原話必須逐字）；回條、被取代的保留、成品檢查、交棒驗證都進了設計討論。
- **不適合的地方**：它解決的是「幾分鐘內多人即時指揮一個 agent」，Tandem 是「幾週到幾個月的團隊決定和分工」；資料存在記憶體、重啟就清空；兩個使用者寫死、沒有登入；repo 沒有授權條款，沿用程式碼要先取得同意。所以決定**另寫一份新的**，只帶走設計想法。
- **來源說法不一**：早期對話讀程式碼後說它是一個網頁 App、伺服器直接呼叫模型 API（GMI Cloud）；Roy 的 agent 的文件則把它描述成「Claude Code／Codex 外掛雛形」。

### pixel-office（Q00jkf）
- **是什麼**：一個 Claude Code plugin，把同時開著的每個工作階段畫成像素辦公室裡的同事，並提供 `team` skill 讓多個工作階段分工、開會。定位是「一個人指揮多個 agent」，剛好和 Readback（多人、一個 agent）互補。
- **怎麼做的**：一個檔案只有一個寫入者；拆成多個工作階段要有理由（需要獨立觀點、可平行、上下文會互相干擾）；決策者角色不建成 agent、核准永遠回到人；開會時每人先各自提案、不讀別人的提案，主持人整合，解不開才請人裁示；訊息只傳檔案路徑不貼全文。
- **我們拿了什麼**：「決策權歸人」「拆分要有理由」「先各自提案再整合」這幾條，和我們獨立想到的結論一致，當作佐證。
- **不適合的地方**：使用者說先不管像素風和視覺化；它是單人工具，沒有多人的團隊狀態。

---

## 二、多人協作工具

### Cursor Multiplayer Projects
- **是什麼**：Cursor 編輯器裡的多人專案（2026-11 開始測試），是和我們最像的大公司產品。
- **怎麼做的**：每人一個自己的「協調 agent」，共用任務看板和共用資料區；個人對話保持私人；協調 agent 不寫程式，把工作派給背景 worker。Roy 的 agent 的文件另外分析了 Cursor app 的程式碼（非官方）：共同記憶是一份由 agent 自己寫的 `notes.md`、共用檔案靠檔案鎖和版本號防衝突、**隊友 agent 傳來的訊息被當成不可信的內容**。
- **我們拿了什麼**：「每人一個自己的 agent＋共用記憶和看板」這個方向得到驗證；「把別人傳來的文字當資料、不當指令」成為 Tandem 的安全規則。
- **不適合的地方**：要同一個付費團隊（每席每月 30 美元起）、要綁一個程式碼 repo、跑在 Cursor 雲端、不能用個人的 Claude／ChatGPT 訂閱。
- **來源說法不一**：早期只找到一篇第三方報導，說不同隊友的 agent 會互相協商；Roy 的 agent 的文件引官方文件，說隊友 agent 的訊息只進側聊、只回答問題，**不能派同伴的 agent 做事**。

### Omnigent（Databricks 和 Neon 開源）
- **是什麼**：包在 agent 外面的一層（自稱 meta-harness），把 Claude Code、Codex、Cursor 等 18 種 agent 放進同一個介面，可自架伺服器多人使用。2026 年 6 月開源、Apache 2.0、仍是 alpha。
- **怎麼做的**：伺服器管帳號、對話紀錄和政策；每台登記的電腦跑實際的 agent。每個動作先過**政策**（放行／先問人／擋下，分三層、會累計花費和次數）。多人時可以唯讀觀看（預設看不到檔案），或給「可編輯」一起操作同一個 agent（共駕）。內建範例 Polly 把工作派給不同家的 agent，再交給另一家模型審查。
- **我們拿了什麼**：政策「放行／先問／擋下」的寫法；**找另一家的模型來審查**；在 GitHub Actions 裡只把權限給「貼留言」那一步、不處理外部 fork 的 PR；房間功能借用了它的邀請連結、唯讀／可輸入兩種權限、每句話標上名字。
- **不適合的地方**：多人要一台一直開著的伺服器；共駕等於讓別人在你電腦上執行任何程式，而且可編輯的人自己就能按核准，做不到「本人看過才跑」；在 Windows 上沒有檔案和網路的隔離。Tandem 的房間不讓別人碰自己的電腦：AI 只跑在主持人的電腦上，隊友是在 GitHub 上留言跟它對話。

### Claude 官方的團隊功能
- **Team 方案**：共享 Projects（共用檔案和指示，但對話和記憶仍是個人的）、集中計費、管理功能。
- **Claude Tag**（Slack，beta）：每個頻道一個共用的 Claude，用管理員設定的服務帳號運作、不代表任何個人，記憶限在頻道範圍。
- **Claude Code 的 Projects 和 Remote Control**：Roy 的 agent 的文件查到兩者都是**單人**功能（專案不能分享給別人）。
- **Claude Meetings**（11 月推出，Google Meet，beta）：會議中做筆記、起草文件、產生紀錄；只開放 Team／Enterprise，產出留在 Claude 裡。
- **Claude Code channels**（研究預覽）：可以把 Discord 訊息送進主持人正在跑的 session；但只支援 Claude、還在預覽、主持人電腦要一直開。
- **我們學到的**：公司買 Team 方案就有這些，所以 Tandem 的目標使用者改成**臨時組隊的小團體**（黑客松、偶爾一起做專案、各自用不同方案的人）。也因為 Google 的 Meet Media API 只到測試階段、將在 2027 年 1 月關閉，房間不進會議軟體，獨立存在。

### 「遞紙條」型：T3 Code 訪客連結、claude-share、ccshare
- **怎麼做的**：都跑在主人電腦、用主人的訂閱。T3 Code 的訪客送的訊息要主人按下才執行；claude-share 預設每個編輯、指令、網路呼叫都要主人先同意；ccshare 只讀到二手介紹，不確定細節。
- **我們學到的**（Roy 的 agent 的文件）：「本人看過才跑」做得最乾淨的是這一類，但它們只有一個主人加旁聽者，不算真的多人；而且用主人的訂閱跑別人的指令，條款上有疑慮。

### 其他平台（一句話帶過）

| 產品 | 重點 | 對我們的意義 |
|---|---|---|
| OpenAI 群組對話、共享專案 | 最多 20 人一起和 ChatGPT 對話；群組不用、也不產生個人記憶 | 個人空間和共享空間要分開 |
| Notion 自訂 agent | 每個 agent 有自己的權限、有稽核紀錄 | agent 要有自己的身分 |
| Microsoft Teams 的會議 agent | 把會議決定轉成有負責人的任務 | 仍以開會為中心，我們想少開會 |
| Google Gemini 企業版 | agent 有自己的 email、行事曆 | 同上，agent 有身分 |
| Figma 畫布上的 agent | 多人一起對 AI 下指令 | 多人共用 AI 的例子 |
| Zed、PostHog、Asana、Dust | 多人加多 agent 在同一空間工作 | 「多人共用的 AI」已是明確趨勢 |
| Devin Teams | 可逐人連結自己的 ChatGPT 方案（Roy 的 agent 的文件） | 各付各的有前例，但仍跑在 Devin 雲端 |

### 相關文章和研究
- **Anthropic〈Building effective human-agent teams〉**：預設公開、agent 權限不綁某個人、人寫北極星目標、自主權逐步放寬、一個做一個驗。最重要的反例是**每個人經營自己的 AI 團隊，結果上下文四分五裂**。這直接推翻了我們早期「每人帶自己的 agent 副手」的設計，改成「狀態屬於團隊，agent 只是來做事的」。
- **Cybernetic Teammate（P&G 約 780 人的實驗）**：一人加 AI 約等於兩人沒 AI，兩人加 AI 最容易出頂尖點子。結論是 AI 讓人和人的合作更好，而不是取代合作。
- **CMU Agent Company**：全由 AI 組成的公司，完成率低、協調成本高。

---

## 三、任務與指派

### GitHub Agent HQ／Copilot cloud agent
- **是什麼**：在 GitHub 上把 issue 指派給 Copilot、Claude 或 Codex 的入口（現在叫 Agents tab），有跨裝置的進度控制台。
- **怎麼做的**：agent 跑在 GitHub Actions，交付物是 PR；權限用分支層級控管；GitHub 會濾掉隱藏字元、只把有寫入權限的人的留言給 agent 看。計費從 Copilot 額度扣（6 月起改依用量），細節官方說明不完整。
- **我們拿了什麼**：Tandem 的任務、討論、成品都直接用 GitHub 的 issue、Discussions 和 PR；不可逆的關卡（分支保護、CODEOWNERS、必要檢查）交給 GitHub 強制，不靠 agent 自覺。
- **不適合的地方**：雲端 agent 都要另外付費；即時協作弱，跑到一半不能改方向；全以程式為中心。

### Linear
- **是什麼**：把 agent 當成工作區正式成員的任務管理工具。
- **怎麼做的**：agent 可以被指派、被 @，但**「委派」和「負責」分開**：做事的是 agent，負責人仍然是人。agent 不算付費席位，但提供 agent 的服務各自收費。
- **我們拿了什麼**：「委派不等於負責，責任留在人身上」。
- **不適合的地方**：使用者決定先專注在自己的產品加 GitHub，Linear、Slack、Discord 之後再說。

### CCPM（Claude Code PM）
- **怎麼做的**：用 GitHub Issues 當唯一事實來源，需求拆成 epic 再拆成 issue，多個 agent 在不同 git worktree 平行做，自動產生站會報告。
- **我們拿了什麼**：用大家本來就會的現成工具當事實來源；報告是工作的副產品。

---

## 四、接 agent 的方式

### T3 Code（pingdotgg）
- **是什麼**：開源的桌面控制台，驅動你電腦上已經登入的各家 agent，自己沒有模型。
- **怎麼做的**：每家一個轉接器（Claude 用 Agent SDK、Codex 用 app-server、其他用各自的 SDK 或 ACP），把各家事件翻成同一套格式；伺服器是唯一真正執行的地方，網頁、桌面、手機都連它；狀態用事件紀錄存在 SQLite，每輪用隱藏的 git ref 存檢查點；平行工作用 git worktree。
- **我們拿了什麼**：程式架構「一個核心、多個介面」；桌面版用 Electron 執行同一份伺服器、讓 `tandem` 指令出現在 PATH 的做法、本機看板的一次性通行碼、用作業系統鑰匙圈存權杖，都是照 T3 Code 的做法。
- **不適合的地方**：它是給一個人用的控制台，沒有多人的團隊狀態。它用 Agent SDK 配使用者的訂閱是否事先取得 Anthropic 同意，查不到。

### MCP、SDK、協定：該用哪個
- **差別**：MCP 是 agent 主動來呼叫你（像幫員工裝一支直通資料室的分機）；SDK／協定是你驅動 agent（像當他的主管，能啟動、看每一步、叫停）。T3 Code 的產品本身就是控制台，所以用 SDK；我們的核心是**共享的團隊狀態**，所以 MCP 加上 hooks 更合適。
- **ACP**（Agent Client Protocol，Zed 發起）：一個轉接器接 25 家以上 agent，但 Claude 透過 ACP 底層還是 Agent SDK。**A2A**：不同組織的 agent 互相溝通，目前用不到。
- **單人多 agent 控制台**：Superset、Conductor、Vibe Kanban 都能平行跑 agent，但都是一個人在控制。
- **演變**：早期建議先做 MCP；後來討論 Claude Code 和 Codex 雙支援時，改成先做**命令列工具**（`tandem` 指令）當核心，因為比較省 token、兩家行為一致、少踩設定的坑，MCP 只是包在外面的一層；003 再加上 `tandem mcp`，和命令列共用同一份邏輯。

### 開放標準：AGENTS.md、Agent Skills、MCP
- **怎麼做的**：Linux 基金會成立 Agentic AI Foundation，收下 Anthropic 的 MCP 和 OpenAI 的 AGENTS.md；SKILL.md 是開放標準，約 40 個工具支援。Claude Code 和 Codex 都原生支援這三樣，hooks 名稱也幾乎一樣（SessionStart、Stop 等）。
- **我們拿了什麼**：使用者要求「正式支援兩家，不是以 Claude 為主再轉接 Codex」，所以 Tandem 的規則寫在 AGENTS.md、CLAUDE.md 只引用它；同一份 SKILL.md 寫到兩家各自讀的資料夾；兩家都用 hook 開工和收工。

### Claude Code 和 Codex 本身的驅動方式（003 研究）
- **Claude Code**：`claude -p` 加 stream-json 可以多輪對話、`--resume` 接續、`--permission-prompt-tool` 把核准交給 Tandem 自己的 MCP 工具。實機驗證過。
- **Codex**：`codex app-server` 是一個雙向 JSON-RPC 介面，有開對話、接續、中斷、核准請求、ChatGPT 登入；細節交給 Roy 實測。
- **訂閱規定（來源和時間點不同，說法變過很多次）**：早期對話查到 2 月禁止第三方用訂閱、5 月又反轉給「Agent SDK 額度」、之後還有暫停和重新啟用的報導，互相矛盾。003 研究時（11/15）直接讀官方條款：產品可以執行**使用者自己登入的原版 Claude Code**，但不能提供 Claude 帳號登入、不能代替使用者用他們的訂閱、不能經手登入資料；Agent SDK 除非事先核准，不能配訂閱登入。所以 Tandem **不用 Agent SDK，直接執行使用者自己的 `claude`**，登入一律走 Claude Code 自己的流程。OpenAI 沒有寫清楚第三方能不能用 ChatGPT 登入驅動 Codex，實作前要再查。

### OpenCode
- **是什麼**：開源的 coding agent，不綁定任何一家模型。
- **怎麼做的**：用戶端和伺服器分開，有公開的 HTTP API 和自動產生的 SDK，可以無介面執行；子 agent 跑在子工作階段。
- **我們學到的**：早期把它列為「雲端工人」的候選執行環境，但目前 Tandem 只正式支援 Claude Code 和 Codex。

### LangChain／LangGraph
- **是什麼**：讓人用程式碼**自己組一個 agent** 的框架。
- **我們學到的**：Tandem 不是 LangChain，因為我們不打造 agent，只協調現成的 agent 和人。但借了概念：「環境型 agent」和人互動的三種模式（通知、提問、審查）、Agent Inbox 的收件匣互動、`interrupt()` 等人時暫停再接續、每步存檢查點、LangSmith 的用量追蹤。
- **不適合的地方**：整套框架當依賴違反「核心要小」；它的 API 過去常大改。原則是**借概念，不借程式碼**。

---

## 五、工作方法與專家 skill

### gstack（Garry Tan）
- **是什麼**：一組 Markdown 斜線指令，把一個 agent 變成虛擬工程團隊（CEO、設計、工程、QA、資安、發布）。
- **怎麼做的**：一個衝刺七階段：想、規劃、做、審查、測試、上線、反思。skill 之間**用檔案交接**；`/autoplan` 依序跑四種審查，**只把需要品味判斷的決定交給人**；`/codex` 請另一家 AI 給第二意見；`/learn` 記錄教訓。
- **我們學到的**：「角色其實是同一個 agent 依序執行的 skill，不是同時存在的員工」；只把需要人的決定交給人。
- **不適合的地方**：為一個人設計，沒有團隊狀態；Windows 只有最低限度支援。

### 其他被大量使用的工作方法 repo

| Repo | 關鍵做法 | 我們拿了什麼 |
|---|---|---|
| obra/superpowers | 先複述理解讓你修正；計畫拆成 2–5 分鐘的小任務；每個任務派新的 subagent，做完兩階段審查 | 「先確認理解」＝回條的已驗證版本 |
| mattpocock/skills | 小而可組合、不包辦全流程；`grill-me` 追問、`wayfinder` 共享決策單、`to-questionnaire` 把未決的事變問卷、`handoff` 交接 | 現成工具裡最接近「以決策為中心」的方向 |
| addyosmani/agent-skills | 每階段有完成條件、一定要用證據收尾、列出 agent 常找的藉口 | 「沒有證據不算完成」 |
| everything-claude-code（ECC） | 最佳化上下文、其他都持久保存；審查要在全新上下文做；**記憶當成未審核的上下文** | 記錄是資料不是指令 |
| andrej-karpathy-skills、ponytail、caveman | 先想再寫、改動越小越好；少寫程式；caveman 宣稱省 65–75% token，獨立測試只省 15–25% | 宣稱的數字要自己量 |
| anthropics/knowledge-work-plugins、anthropics/skills | 官方依職位設計的 plugin（業務、法務、財務、產品等）和 skill 規格範例 | 專家人設已經很多，不是稀缺的東西 |
| VoltAgent subagents、agency-agents、PM skills 系列 | 大量職位人設；deanpeters 的 PM skills 授權不允許商用 | 同上 |
| BMAD-METHOD、MetaGPT（對照 ChatDev） | 依職位和標準流程，用**文件**交接而不是聊天；BMAD 被指出一次交接沒做好錯誤會一路累積 | 用交付物交接；接手方要先確認 |
| GitHub spec-kit、Agent OS | `constitution.md` 記專案原則；每個功能一個資料夾放規格、計畫、研究、任務 | Tandem 的規格資料夾和 research.md 格式照 spec-kit |
| Ruflo（原 claude-flow） | 女王 agent 帶一群 worker，架構很重、走全自動 | 和「人在關鍵點把關」理念不同，不採用 |
| pixel-agents 等像素辦公室 | 讀 Claude Code 的紀錄或 hook 事件，把 agent 畫成角色 | 先不做視覺化 |

**共同結論**：這些 repo 各自發展，卻收斂到相同做法（先釐清需求、規格寫成檔案、拆小任務、在新上下文審查、完成要有證據、學習迴圈），而且**全部都是一個人加一個 agent**。所以 Tandem 不重做執行層的 skill，只做「團隊層」，讓每個人帶自己喜歡的 skill 進來。

---

## 六、記憶

| 做法 | 怎麼做的 | 我們拿了什麼 |
|---|---|---|
| GBrain（Garry Tan） | 事實來源是 git repo 裡的 Markdown，資料庫只是索引、隨時可重建；每頁上方是「目前理解」、下方是只往後加的時間軸；夜間「做夢週期」合併重複、找出矛盾；agent 先查大腦再查外面 | **Markdown 是事實、索引隨時可重建**；保留歷史不覆寫。限制：為一人設計、效能數據有爭議 |
| Karpathy 的 LLM Wiki | 讓 LLM 把原始資料「編譯」成互相連結的 wiki，只是一份想法、沒有程式碼 | Markdown 當記憶、人看得懂改得動 |
| ACE 論文（ICLR 2026） | 生成、反思、整理三個角色，教訓**一條一條追加**，不反覆重寫摘要 | 反覆重寫會流失細節，所以決定寫了就不改 |
| Mem0、Zep／Graphiti、Letta | 自動抽事實存資料庫／會隨時間變化的知識圖譜／agent 自己管理分層記憶 | 只當對照，不採用 |
| CoALA 論文 | 記憶分工作、情節、語意、程序四類 | 讓 agent 變專家的是語意和程序記憶，不是聊天紀錄 |

---

## 七、多 agent 的研究結論

| 研究／文章 | 結論 | 影響 |
|---|---|---|
| Debate or Vote（NeurIPS 2025） | 多 agent 辯論的提升大多來自投票 | 先各自獨立提看法，再整合 |
| Talk Isn't Always Cheap | 不同模型辯論可能越辯越差 | 辯論要短、要有證據 |
| MAST（UC Berkeley） | 多 agent 失敗多出在規格不清、沒對齊、沒驗證 | 重點在系統設計，不在模型 |
| Cognition〈Don't Build Multi-Agents〉 | 沒共享上下文的 agent 會做出互相衝突的決定 | 緊密相關的工作給一個 agent 做 |
| Anthropic 多 agent 研究系統 | 研究任務好 90%，但 token 約 15 倍 | 只在可平行、需要獨立判斷、上下文裝不下時才拆 |
| Stanford STORM、Google co-scientist | 多視角用來「產生問題」；用比賽排名取代自由聊天 | 視角是審查者，不是同事 |

---

## 八、模擬使用者：MatrAIx
- **是什麼**：2026 年 8 月發表的研究，用模擬使用者測試 AI 系統和產品；公開約 100 萬筆人設、四種測試環境，驗證時 91.5% 行為符合設定。
- **不適合的地方**：沒有 API 也沒有 MCP，要 API 金鑰、Docker、Windows 要 WSL2；約 8.5% 行為不符，只適合早期篩選。早期構想把它當成可開關的選用模組，用來代替團隊裡缺少的使用者視角；後來的規格沒有再提到它。

---

## 九、組織和決策的做法

| 做法 | 我們拿了什麼 |
|---|---|
| Apple 的直接負責人（DRI）、RACI | 每類決定有明確的負責人；分出負責、諮詢、知會 |
| Amazon 單向門／雙向門、可以不同意但要承諾 | 依「能不能撤回」決定要不要打擾人 |
| Apache 的懶共識 | 期限內沒人反對就視為同意，可撤回的事不用等 |
| Basecamp Shape Up、Amazon Working Backwards、GitHub 分開 Discussions 和 Issues | 「還在想」和「確定要做」分開放 |
| Team Topologies | 團隊怎麼分的參考框架 |

---

## 十、實作層的參考（規格 001–003 的研究）

| 問題 | 參考了誰 | 結果 |
|---|---|---|
| 紀錄編號會撞號 | log4brains 放棄流水號、Beads 用雜湊編號；adr-tools、MADR、PEP、Backlog.md 用流水號會撞 | 日期加 4 碼亂數 |
| 推翻舊決定 | log4brains 和 PEP 都說定案不改 | 新決定寫「取代誰」，舊檔不動 |
| 決定要有出處 | PEP 定案要連到做出決定的那則發言 | 出處欄位必填 |
| 討論和定案分開 | Rust RFC 討論在討論串、MADR 有「考慮過的做法」 | 未定案的放 Discussions，定案才寫檔 |
| 多人改同一個檔會衝突 | Changesets 一人一檔、彙總檔只讓機器人寫 | 狀態一人一檔、看板讀的時候算 |
| 說明放哪 | Beads、Backlog.md 讓命令列印出做法 | `tandem brief` 是唯一說明來源，repo 只放一小段 |
| 背景同步 | Obsidian Git 排隊、先拉再推、衝突就停 | 衝突絕不自動解決、絕不強制推送 |
| 不碰使用者的工作目錄 | Beads 放棄隱藏 worktree；git-bug、git-appraise 用底層指令直接寫 | 紀錄直接在遠端預設分支產生 commit |
| GitHub 登入 | gh CLI 和 GitHub Desktop 用自己的 OAuth App | 裝置碼登入，`gh` 當備援；不用 GitHub App（受邀者接受前無法安裝） |
| 不用另外裝 git | GitHub Desktop 的 dugite | 桌面版內建 git |

---

## 十一、Roy 的 agent 的文件：36 個情境比較

- **做了什麼**：把「兩個以上的人各用自己的 agent 一起推進任何專案」拆成 36 個情境（建立與成員、同時在線、輪流做、意見與記憶、帳號費用、安全、檢查、看見、範圍與平台），對照 GitHub、Cursor、Omnigent、T3 Code、Claude 五個工具，每格附證據等級（已查證／推論／不確定）。
- **各家在賭什麼**：Cursor 賭每人一個 agent 加共用記憶看板；Omnigent 賭大家想一起操作同一個 agent；GitHub 賭 PR 流程就夠；T3 Code 和 claude-share 賭執行權永遠在主人手上。
- **公認好的做法**：別人傳來的文字一律當不可信內容；開 PR 的人不能自己核准。**不是好做法**：只靠 git worktree 當安全隔離。
- **五家都沒做好的 12 個缺口**：原話不被摘要洗掉、照原話檢查成品、回條、交棒前驗證、各用自己的訂閱又有共用看板、本人看過才跑而且真的多人、人和人意見衝突誰決定、畫出誰在等誰、一人額度用完別人的閒著、非程式專案、Windows 上的安全隔離、回來時告訴你錯過了什麼。
- **三條路**：A 用現成的、B 在現成工具上加功能、C 自己做（文件刻意不推薦）。我們的回答比較接近 B：資料放 GitHub、執行交給各自的原版 Claude Code 或 Codex，加上房間後往 C 跨一小步。
- **對我們的用處**：36 個情境可以直接當測試情境；這份長文件本身也證明了「各自和 agent 討論完再傳一份文件，資訊會流失、要讀完才知道哪些和自己有關」，正是 Tandem 要解決的問題。

---

## 研究得出的結論

1. **空缺在「人和人怎麼一起做決定」，不在「agent 怎麼做事」。** 執行層的 skill 和單人多 agent 的工具已經很成熟，大公司也在做 agent 協作的基礎建設；但誰有權決定、只找被影響的人、把分歧攤開交給人、原話不被摘要，沒有人做好（我們自己的整理和 Roy 的 agent 的 12 個缺口結論一致）。所以 Tandem 只做團隊層，執行交給大家已經在用的 agent 和 skill。
2. **每個人用自己的 agent 和自己的訂閱，透過開放標準接上。** 條款只允許執行使用者自己登入的原版 Claude Code，不能代用訂閱或經手登入資料；而且 Cursor 這類「有共用看板」的產品都不能用個人訂閱。Tandem 用命令列、MCP、hooks、AGENTS.md、Agent Skills 接上 Claude Code 和 Codex，兩家平等，產品本身不碰帳號。
3. **狀態屬於團隊，不屬於某個人的 agent。** Anthropic 的經驗顯示「每人經營自己的 AI 團隊」會讓上下文四分五裂；所以決定、問題、狀態都寫到共用的地方，agent 只是來讀寫的。
4. **GitHub 當儲存和守門員。** 有版本紀錄、格式開放、PR 審查、權限現成，大家本來就會用；第一版不架伺服器。照 GBrain 的思路，Markdown 才是事實，看板和索引讀的時候算、隨時可重建；不可逆的關卡交給 GitHub 強制，不靠 agent 自覺。
5. **原話優先、寫了不改。** 來自 Readback 的記憶板和 ACE 的研究：反覆摘要會流失細節，所以原話逐字保存、新決定取代舊決定時舊的照樣留著。
6. **別人傳來的文字是資料，不是指令。** Cursor、GitHub 都這樣做，也是 Roy 的 agent 列出的公認好做法。房間裡隊友的留言也一樣，交給主持人電腦上的 AI 時會標明是誰說的。
7. **目標使用者是臨時組隊的小團體。** 公司直接買 Team 方案就有共用專案和會議功能；各用不同方案的黑客松隊伍、朋友專案才是現成工具照顧不到的人。
