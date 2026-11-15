# 研究紀錄：Tandem 桌面版（002-desktop）

每一項：決定、理由、參考做法、來源。技術名詞保留英文。001 的研究（R1–R19）仍然有效，這裡只寫 002 新增或修改的部分。

## S1. 紀錄直接寫到預設分支，不經過使用者的 checkout

- **問題**：001 的同步在使用者目前的分支上 commit `tandem/`，然後 `pull --rebase --autostash` 和 `push`。結果有兩個問題：
  1. 分支上還沒推送的程式碼 commit 會被一起推上去。在 main 上，這會繞過 PR。
  2. 在功能分支上記的決定只進了那個分支，隊友要等合併才看得到。
  3. 另外，`pull --rebase --autostash` 會改寫使用者還沒推送的 commit，也會暫存使用者還沒提交的修改。背景程式不應該做這些事。
- **決定**：寫入紀錄時不碰工作目錄，用 git plumbing 直接在 `origin/<預設分支>` 上產生 commit 並推送：
  1. `git fetch origin <預設分支>`
  2. 用暫時的 index（`GIT_INDEX_FILE` 指到 `.git/tandem/index`），`git read-tree origin/<預設分支>`。
  3. 把要寫的檔案 `git hash-object -w`，再用 `git update-index --add --cacheinfo` 放進暫時的 index（刪除用 `--remove`）。
  4. `git write-tree` → `git commit-tree -p origin/<預設分支>`，作者是使用者自己。
  5. `git push origin <commit>:refs/heads/<預設分支>`。如果被拒絕（別人先推了），回到步驟 1 重做。紀錄是一筆一檔、狀態是一人一檔，重做不會衝突。
  6. 推送失敗或離線時，把待寫的內容留在本機佇列（`.git/tandem/outbox/`），之後重試。
- **讀取**：看板和 brief 讀 `origin/<預設分支>:tandem/`（`git ls-tree` 加 `git cat-file --batch`），再疊上 outbox 裡還沒推出去的內容。工作目錄裡的 `tandem/` 只是使用者分支上的副本，不當作資料來源。
- **使用者的 checkout**：完全不碰。使用者在 main 上時，下次 `git pull` 會 fast-forward 拿到這些 commit。在功能分支上時，合併 main 就會拿到，也不會有衝突。
- **理由**：
  - 符合「紀錄直接進 main」（D-20261115-gr52），也完全不會碰到使用者的程式碼。
  - 不需要第二個工作目錄。Beads 早期用隱藏的 git worktree 同步到獨立分支，後來因為卡住的 worktree 會擋到使用者切換分支等問題而放棄，改成把資料放在獨立的 ref。
  - 我們仍然寫到預設分支，而不是獨立的 ref，因為紀錄要能在 GitHub 網頁上直接看到、點到（001 的設計）。
- **風險**：
  - 預設分支設了保護規則時會推不上去。免費的私人 repo 不能設保護規則；遇到時顯示白話說明。
  - 使用者在 main 上手動改了 `tandem/` 的檔案又 commit，可能和背景寫入衝突。只會在使用者手改紀錄時發生，這時顯示「需要處理」，和 001 一樣絕不強制推送。
- **參考**：
  - Beads 從 sync branch 加 worktree 改成獨立 ref 的過程
  - git-bug 和 git-appraise 用 plumbing 寫入不經過工作目錄
  - GitHub 網頁編輯檔案也是直接在遠端產生 commit
- **來源**：[Beads protected branches](https://beads.gascity.com/reference/protected-branches)、[Beads git integration](https://beads.gascity.com/reference/git-integration)、[git commit-tree](https://git-scm.com/docs/git-commit-tree)、[git read-tree / GIT_INDEX_FILE](https://git-scm.com/docs/git-read-tree)

## S2. 成員動態：從 GitHub 推算，不存檔

- **決定**：每個成員的「最近動態」從這些來源推算：
  - 所有遠端分支上、這個成員最近 7 天的 commit（`git log --remotes --author`，用 GitHub 帳號對應的 email 或 noreply 位址比對；比對不到時用 GitHub API 的 commit author login）
  - 這個成員開的或合併的 PR
  - 在 Discussions 和 Issues 的留言

  讀取時計算，不寫進 repo。
- **理由**：001 的看板要靠 agent 寫狀態才有內容，剛開始是空的，看不出效果。commit 和 PR 本來就在發生，不需要任何人多做事。GitHub 的 repo Insights 和 Linear 的活動紀錄都是這樣從既有事件推算。
- **注意**：commit 的作者 email 不一定對得到 GitHub 帳號。優先用 GitHub API 回傳的 `author.login`，本機 git 只當備援。

## S3. 內建 git：dugite

- **決定**：用 dugite（GitHub Desktop 的 git 包裝），隨 app 帶一份 Git for Windows。
  - `runGit` 依序找：環境變數 `TANDEM_GIT` → 系統 `git`。桌面版和它提供的 `tandem` shim 都會設定 `TANDEM_GIT`。
  - 執行時照 dugite 的 `lib/git-environment.ts` 設定 `GIT_EXEC_PATH` 和 PATH。git 資料夾放進 `asarUnpack`。
- **理由**：使用者不用另外裝 git。dugite 目前是 v3.3.3（2026-11-10），內含 git 2.56.1，MIT 授權，仍在維護。
- **注意**：
  - Windows x64 壓縮後約 47 MB，安裝檔會變大，解壓後的大小還要實際量。
  - Claude Code 和 Codex 自己跑 git 時仍然用系統的 git，和我們無關。
- **來源**：[dugite](https://github.com/desktop/dugite)、[dugite-native releases](https://github.com/desktop/dugite-native/releases)

## S4. 沒有 npm 也能讓 `tandem` 在 PATH 上

- **決定**：照 T3 Code 的 `DesktopCliShim.ts` 做。
  - app 每次啟動都在 `%LOCALAPPDATA%\Tandem\bin\` 重寫兩個檔：
    - `tandem.cmd`：設 `ELECTRON_RUN_AS_NODE=1`，再用 app 的 exe 執行 CLI 入口。
    - 沒有副檔名的 `tandem`：sh 腳本，給 Git Bash 用。
  - 把這個資料夾加進使用者 PATH（`HKCU\Environment`），保留 `REG_EXPAND_SZ`，再廣播 `WM_SETTINGCHANGE`。讀不到 PATH 時要放棄，絕不覆寫。
  - shim 開頭放標記，不覆蓋不是我們寫的同名檔。
- **理由**：
  - Claude Code 在 Windows 預設用 Git Bash 執行 hook，沒有 Git Bash 時用 PowerShell。npm 也因為這個原因，同時產生 sh 和 `.cmd` 兩種檔。
  - T3 Code 已經用同樣的做法上線。
- **風險**（要實機測）：
  - Electron 的 exe 是 GUI 程式，hook 要靠 stdin 和 stdout 傳 JSON，要確認在這種情況下能正常運作。不行的話，改附一個小的 console 啟動器。
  - 已經開著的 agent 看不到新的 PATH，第一次安裝後要提示重開。
  - Codex 在 Windows 用哪個 shell 執行 hook 還不確定（文件只提到 `commandWindows`）。
- **來源**：[T3 Code DesktopCliShim.ts](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/app/DesktopCliShim.ts)、[Claude Code hooks](https://code.claude.com/docs/en/hooks)、[Codex hooks](https://learn.chatgpt.com/docs/hooks)

## S5. GitHub 登入：OAuth App 加裝置碼流程（取代 001 借用 gh 的做法）

- **決定**：
  - 註冊 Tandem 的 OAuth App，開啟 Device Flow，scope 用 `repo` 和 `read:org`。
  - 權杖存在 Windows 認證管理員（`@napi-rs/keyring`），讀取順序：`TANDEM_TOKEN` → keyring → `gh auth token`。
  - git 推送時，只在子行程的環境變數放權杖（`GIT_CONFIG_COUNT`，設定 `http.https://github.com/.extraHeader`，並清空 `credential.helper`）。權杖不寫進 `.git/config`，也不出現在命令列。
- **為什麼不用 GitHub App**：
  - GitHub App 的權杖只能用在已經安裝這個 App 的 repo。被邀請的人在接受邀請前不可能已經裝好，「邀請就能開始」會被打斷。
  - 接受邀請需要 Administration 寫入權限，範圍太大。
- **OAuth App 註冊在 sudo-studio-lab 組織下**：
  - @jielle2453 是組織管理員，可以直接建立。
  - 組織自己的 OAuth App 不受「第三方 OAuth 存取限制」影響。其他組織的使用者第一次用時，需要他們的組織擁有者核准一次，app 要用白話引導。
- **權杖不設過期**（建立時取消勾選「Expire user access tokens」），和 gh 一樣，不用處理每 8 小時換一次權杖。
- **參考**：
  - gh 用內嵌公開 client id 的裝置碼流程。
  - GitHub Desktop 用自己的 OAuth App。
- **來源**：[OAuth 授權（裝置碼）](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)、[組織 OAuth 存取限制](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/about-oauth-app-access-restrictions)、[gh authflow](https://github.com/cli/cli/blob/trunk/internal/authflow/flow.go)

## S6. 先不簽章，用安裝檔清單簽章保護更新

- **決定**：
  - 002 先不做程式簽章。安裝時，SmartScreen 會顯示「Windows 已保護您的電腦」，要按「其他資訊 → 仍要執行」。
  - 自動更新用 electron-builder 的 Ed25519 簽章清單，確保下載的更新沒被竄改。
  - 對外發布前再處理簽章，選項有兩個：
    - SignPath Foundation：免費，但要求開源。
    - 用公司名義買 OV 憑證。
- **風險**：Windows 11 的 Smart App Control 開啟時，會直接擋下沒簽章的程式，而且沒有「仍要執行」。要先確認兩台電腦的設定：設定 → Windows 安全性 → 應用程式與瀏覽器控制。
- **資格**：Azure Artifact Signing 的個人申請只限美國和加拿大，組織只限美國、加拿大、歐盟和英國，台灣不符合。
- **來源**：[SmartScreen 信譽](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)、[簽章選項](https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options)、[electron-builder auto-update](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)

## S7. 邀請：登入後自動列出，連結只是加分

- **決定**：
  - 主流程不靠連結：被邀請的人裝好 app、用 GitHub 登入後，app 呼叫 `GET /user/repository_invitations`，列出「@某某 邀請你加入 owner/repo」，按「加入」就會接受、clone、打開看板。
  - 分享文字放一個 https 下載頁。頁面上有下載按鈕，也會嘗試用 `tandem://join?repo=owner/repo` 打開已經安裝的 app。
- **理由**：
  - Slack、Discord 這類聊天軟體多半不會把 `tandem://` 變成可以點的連結。GitHub 的 Markdown 也會把自訂 scheme 的連結拿掉。
  - Zoom 和 Discord 的邀請連結都是先打開 https 頁面，再叫起 app。
- **限制**：
  - 接受邀請前讀不到私人 repo 的內容，所以分不出那個 repo 是不是 Tandem 專案。邀請連結裡的 repo 名稱可以用來把它排到最上面。
  - 使用者也可能已經從 email 接受了邀請，app 要能處理「已經是協作者」的情況。
- **來源**：[Electron 深層連結](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)、[Claude Code deep links](https://code.claude.com/docs/en/deep-links)、[邀請 API](https://docs.github.com/en/rest/collaborators/invitations)

## S8. 安裝檔和下載頁放在另一個公開 repo

- **決定**：另外開一個公開 repo `sudo-studio-lab/tandem-releases`，用 Releases 放安裝檔和 `latest.yml`，用 GitHub Pages 放下載頁。程式碼留在私人 repo，CI 只用一個只能寫入 `tandem-releases` 的權杖來發布。
- **理由**：
  - electron-updater 從私人 repo 更新時，每個使用者都要提供權杖。
  - 免費方案的 GitHub Pages 只支援公開 repo。
  - 安裝檔公開沒有關係。下載頁不放任何私人資料，repo 名稱只放在網址的 `#` 後面，不會送到伺服器。
- **來源**：[electron-builder publish](https://github.com/electron-userland/electron-builder/blob/master/website/docs/publish.md)、[GitHub Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## S9. Electron 執行同一份伺服器

- **決定**：照 T3 Code：
  - 主行程用 `spawn(process.execPath, [serverEntry, "serve", "--port", "0"], { env: { ELECTRON_RUN_AS_NODE: "1" } })` 啟動 CLI 的伺服器。
  - 一次性通行碼由主行程產生，經 stdin 傳給伺服器。
  - 伺服器就緒後在 stdout 印一行 JSON（`{"ready":true,"port":…}`），視窗再 `loadURL`。
  - 伺服器崩潰時重啟，等待時間從 0.5 秒逐次加長，最多 10 秒。
  - 用 `requestSingleInstanceLock()`，避免同時跑兩個 app。
- **跨行程競爭**：常駐的伺服器和 agent hook 的 `tandem` 是不同行程，001 的 git 排隊只在單一行程內有效。
  - S1 的寫法本身就不碰工作目錄。
  - 寫入時再用 `.git/tandem/lock` 檔案鎖，把 fetch、建 commit、push 這一段串起來。
  - outbox 一個檔案一筆，用「先寫暫存檔再改名」的方式寫入，避免寫到一半被讀到。
- **來源**：[T3 Code DesktopBackendManager.ts](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/backend/DesktopBackendManager.ts)

## S10. 托盤、通知、開機啟動、自動更新、打開 agent

- **通知**：
  - `app.setAppUserModelId(appId)`，安裝程式建立的開始功能表捷徑也要帶同一個 AUMID。`appId` 發布後就不能改。
  - Windows 的「勿擾」會安靜丟掉通知，所以托盤圖示也要顯示數字，不能只靠通知。
- **托盤**：關閉視窗時只是隱藏。托盤選單有：開啟、暫停同步、結束。
- **開機啟動**：用 `app.setLoginItemSettings`，預設關閉。第一次登入後問使用者一次。
- **自動更新**：electron-builder 的 NSIS 安裝檔（per-user、oneClick）搭配 electron-updater，設 `autoInstallEvent: "onNextLaunch"`。只有托盤、沒有視窗的 app 偵測不到 Windows 關機，所以不能在關機時更新。
- **打開 agent**：
  - 預設用 `wt.exe -d <資料夾> claude`（或 `codex`），沒有 Windows Terminal 時改用 PowerShell。
  - 先用 `where` 偵測有沒有裝。沒裝就顯示安裝連結，不替使用者安裝。
  - 用參數陣列執行，不拼接命令字串，避免注入。
  - 選用：`claude://code/new?folder=`（Claude 桌面版會跳確認）、`codex://new?path=`、`vscode://file/`。
- **來源**：[Electron 通知](https://www.electronjs.org/docs/latest/tutorial/notifications)、[app API](https://www.electronjs.org/docs/latest/api/app)、[T3 Code installer.nsh](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/resources/installer.nsh)、[Claude 桌面版連結](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)、[Codex commands](https://learn.chatgpt.com/docs/reference/commands)

## 要實機驗證的項目

1. 用 `ELECTRON_RUN_AS_NODE` 執行的 shim 當 Claude Code hook 時，stdin 和 stdout 能不能正常傳 JSON；Git Bash 和 PowerShell 都要測。
2. Codex 在 Windows 用哪個 shell 執行 hook，以及 `commandWindows` 的行為。
3. 兩台電腦上，沒簽章的安裝檔實際會看到什麼畫面，以及 Smart App Control 是否開啟。
4. 沒簽章時，自動更新從頭到尾能不能跑完。
5. dugite 的 git 搭配 `GIT_CONFIG_COUNT` 和 `extraHeader` 能不能推送。
6. 在 LINE 貼上 https 下載頁的連結，點開後的實際樣子。
