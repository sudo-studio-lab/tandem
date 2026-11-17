import type { ActivityItem, BoardData, Decision, ProjectBoard, WaitingItem } from "@tandem/contracts";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const H = 3_600_000;
const D = 24 * H;
const REPO = "https://github.com/jielle2453/demo-project";

function decision(
  id: string,
  slug: string,
  date: string,
  title: string,
  strength: Decision["frontmatter"]["strength"],
  extra: Partial<Omit<Decision, "frontmatter">> & { fm?: Partial<Decision["frontmatter"]> } = {},
): Decision {
  const { fm, ...rest } = extra;
  return {
    frontmatter: {
      id,
      title,
      date,
      deciders: ["jielle2453", "theroyatlas"],
      consulted: [],
      strength,
      source: "chat",
      supersedes: [],
      ...fm,
    },
    path: `tandem/decisions/${date.replaceAll("-", "")}-${slug}.md`,
    quotes: [],
    decision: "",
    why: "",
    supersededBy: [],
    ...rest,
  };
}

/** Realistic fixture for `?mock=1` and for `vite dev` without a server. */
export function mockBoard(): BoardData {
  const waiting: WaitingItem[] = [
    {
      kind: "discussion",
      title: "登入要不要支援 Google？",
      url: `${REPO}/issues/12`,
      from: "jielle2453",
      to: "theroyatlas",
      since: ago(26 * H),
    },
    {
      kind: "pr_review",
      title: "#15 加入看板頁面",
      url: `${REPO}/pull/15`,
      from: "theroyatlas",
      to: "jielle2453",
      since: ago(3 * H),
    },
  ];
  const tasks = [
    {
      number: 8,
      title: "做登入頁",
      url: `${REPO}/issues/8`,
      state: "open" as const,
      assignees: ["theroyatlas"],
      labels: ["tandem:task"],
      author: "jielle2453",
      blockedBy: [9],
      createdAt: ago(5 * D),
      updatedAt: ago(1 * D),
    },
    {
      number: 9,
      title: "決定資料庫要用哪一種",
      url: `${REPO}/issues/9`,
      state: "open" as const,
      assignees: ["jielle2453"],
      labels: ["tandem:task"],
      author: "jielle2453",
      blockedBy: [],
      createdAt: ago(6 * D),
      updatedAt: ago(2 * D),
    },
  ];
  const prs = [
    {
      number: 15,
      closes:[8],
      title: "加入看板頁面",
      url: `${REPO}/pull/15`,
      author: "theroyatlas",
      state: "open" as const,
      draft: false,
      requestedReviewers: ["jielle2453"],
      createdAt: ago(3 * H),
      updatedAt: ago(3 * H),
    },
    {
      number: 14,
      title: "整理狀態檔格式",
      url: `${REPO}/pull/14`,
      author: "jielle2453",
      state: "merged" as const,
      draft: false,
      requestedReviewers: [],
      createdAt: ago(2 * D),
      updatedAt: ago(1 * D),
      mergedAt: ago(1 * D),
    },
  ];

  const decisions: Decision[] = [
    decision("D-20261112-a1b2", "local-web-first", "2026-11-12", "先做本機網頁，不做桌面程式", "preference", {
      quotes: [
        { by: "jielle2453", text: "我們先在本機開網頁就好，桌面程式之後再說。", source: "chat" },
        {
          by: "theroyatlas",
          text: "同意，桌面程式要簽章很麻煩。",
          source: "https://github.com/jielle2453/demo-project/issues/3#issuecomment-1",
        },
      ],
      decision: "第一版只提供本機網頁看板。",
      why: "省下打包與簽章的成本，先驗證大家會不會天天打開。",
    }),
    decision("D-20261113-c3d4", "no-secrets-in-repo", "2026-11-13", "任何金鑰都不能放進 repo", "hard", {
      quotes: [
        {
          by: "theroyatlas",
          text: "金鑰一旦進了 git 歷史就收不回來，絕對不要放。",
          source: "chat",
          relayedBy: "jielle2453",
        },
      ],
      decision: "金鑰只放在使用者自己的環境，repo 內一律不存。",
      why: "git 歷史無法真正刪除，外洩風險不可接受。",
    }),
    decision("D-20261114-e5f6", "postgres", "2026-11-14", "資料庫先用 Postgres", "hunch", {
      fm: { deciders: ["jielle2453"] },
      noQuoteBy: "jielle2453",
      decision: "先用 Postgres。",
      why: "團隊最熟，之後要換也不難。",
      supersededBy: ["D-20261115-g7h8"],
    }),
    decision("D-20261115-g7h8", "sqlite-for-now", "2026-11-15", "資料庫改用 SQLite（只限第一版）", "one-off", {
      fm: { supersedes: ["D-20261114-e5f6"] },
      quotes: [{ by: "theroyatlas", text: "第一版不需要伺服器，SQLite 一個檔案就夠了。", source: "chat" }],
      decision: "第一版用 SQLite，要擴充時再重新評估。",
      why: "不用架伺服器，部署最簡單。",
    }),
  ];

  const me = "jielle2453";
  return {
    repo: { owner: "jielle2453", name: "demo-project", url: REPO },
    me,
    members: [
      {
        login: me,
        status: {
          login: me,
          path: "tandem/status/jielle2453.md",
          notes: "",
          updated: ago(3 * H),
          doing: "寫看板網頁的第一版",
          next: "接上即時更新，然後測手機版面",
          blocked: "",
          fyi: [{ text: "資料庫改用 SQLite，只限第一版", ref: "D-20261115-g7h8" }, { text: "週五前不要動狀態檔格式" }],
          deliverables: [{ title: "看板設計稿", url: "https://example.com/design/board" }],
        },
        waitingOn: [waiting[0]!],
        waitedOnBy: [waiting[1]!],
        openTasks: [tasks[1]!],
        recentPullRequests: [prs[1]!],
      },
      {
        login: "theroyatlas",
        status: {
          login: "theroyatlas",
          path: "tandem/status/theroyatlas.md",
          notes: "",
          updated: ago(26 * H),
          doing: "做登入頁",
          next: "串接登入 API",
          blocked: "等資料庫決定才能設計使用者資料表",
          fyi: [],
          deliverables: [{ title: "登入流程圖", url: "https://example.com/flow/login" }],
        },
        waitingOn: [waiting[1]!],
        waitedOnBy: [waiting[0]!],
        openTasks: [tasks[0]!],
        recentPullRequests: [prs[0]!],
      },
    ],
    waiting,
    discussions: [
      {
        id: "disc-12",
        number: 12,
        title: "登入要不要支援 Google？",
        url: `${REPO}/issues/12`,
        kind: "question",
        author: "jielle2453",
        waitingOn: ["theroyatlas"],
        commenters: [],
        answered: false,
        closed: false,
        createdAt: ago(26 * H),
        updatedAt: ago(26 * H),
      },
      {
        id: "disc-10",
        number: 10,
        title: "看板要不要顯示已結束的任務",
        url: `${REPO}/issues/10`,
        kind: "disagreement",
        author: "theroyatlas",
        waitingOn: [],
        commenters: ["jielle2453"],
        answered: true,
        closed: true,
        createdAt: ago(4 * D),
        updatedAt: ago(3 * D),
      },
    ],
    tasks,
    pullRequests: prs,
    decisions,
    problems: [
      {
        path: "tandem/decisions/20261113-no-secrets-in-repo.md",
        severity: "warning",
        code: "missing-field",
        message: "這份決定沒有寫「適用範圍」",
      },
    ],
    sync: { state: "idle", lastSyncAt: ago(4 * 60_000) },
    generatedAt: new Date().toISOString(),
  };
}

/** The 002 board: the fixture plus per-member activity. A third member has neither status nor activity. */
export function mockProjectBoard(projectId: string, me: string): ProjectBoard {
  const b = mockBoard();
  const [owner = "demo", name = "project"] = projectId.split("/");
  b.repo = { owner, name, url: `https://github.com/${owner}/${name}` };
  b.me = me;
  b.members.push({ login: "mei-lin", waitingOn: [], waitedOnBy: [], openTasks: [], recentPullRequests: [] });
  const activity: Record<string, ActivityItem[]> = {
    jielle2453: [
      { kind: "commit", login: "jielle2453", title: "加上看板的活動區塊", url: `${REPO}/commit/a1`, time: ago(2 * H), branch: "main", count: 3 },
      { kind: "pr_merged", login: "jielle2453", title: "整理狀態檔格式", url: `${REPO}/pull/14`, time: ago(1 * D) },
    ],
    theroyatlas: [
      { kind: "pr_opened", login: "theroyatlas", title: "加入看板頁面", url: `${REPO}/pull/15`, time: ago(3 * H) },
      { kind: "comment", login: "theroyatlas", title: "登入要不要支援 Google？", url: `${REPO}/issues/12#c1`, time: ago(5 * H) },
    ],
  };
  return { ...b, projectId, activity, defaultBranch: "main", pendingWrites: 0 };
}
