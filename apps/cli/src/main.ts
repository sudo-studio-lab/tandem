import { Command } from "commander";
import { PRODUCT } from "@tandem/contracts";
import {
  cmdAsk,
  cmdBrief,
  cmdCheck,
  cmdDecide,
  cmdDisagree,
  cmdDoctor,
  cmdInit,
  cmdInvite,
  cmdJoin,
  cmdResolve,
  cmdStatus,
  cmdSync,
  cmdTask,
  collect,
} from "./commands.ts";
import { cmdHook } from "./hook.ts";
import { describeError, exitCodeFor, info } from "./io.ts";
import pkg from "../package.json" with { type: "json" };

export function buildProgram(): Command {
  const program = new Command(PRODUCT.command)
    .description(`${PRODUCT.displayName}：讓每個人的 AI agent 共享決定和進度`)
    .version(pkg.version)
    .showHelpAfterError();

  program
    .command("board", { isDefault: true })
    .description("在瀏覽器打開本機看板")
    .option("--port <port>", "連接埠", (v) => Number(v))
    .option("--no-open", "不要自動打開瀏覽器")
    .action(async (o) => {
      const { startServer } = await import("./server.ts");
      await startServer({ cwd: process.cwd(), port: o.port, openBrowser: o.open });
    });

  program
    .command("serve")
    .description("給桌面 app 用：啟動本機伺服器")
    .option("--port <port>", "連接埠，0 代表自動挑", (v) => Number(v))
    .option("--token-stdin", "從標準輸入讀一行通行碼")
    .option("--desktop", "桌面 app 模式")
    .action(async (o) => {
      let sessionToken: string | undefined;
      if (o.tokenStdin) sessionToken = await readLine();
      const { startServer } = await import("./server.ts");
      await startServer({ port: o.port ?? 0, sessionToken, desktop: !!o.desktop, readyLine: true, openBrowser: false });
    });

  program
    .command("init")
    .description("在目前的 repo 開始使用（可重複執行）")
    .option("--check", "只檢查哪些部分缺少或過期")
    .option("--no-push", "設定完不推送")
    .option("--enable-discussions", "沒開 Discussions 時直接開啟，不詢問")
    .option("--no-board", "設定完不打開看板")
    .option("--json", "輸出 JSON")
    .action((o) => cmdInit(o));

  program.command("invite <login>").description("邀請 GitHub 帳號加入，並產生分享文字").option("--json").action((l, o) => cmdInvite(l, o));
  program
    .command("join <repo>")
    .description("接受邀請、下載專案、打開看板（owner/repo）")
    .option("--dir <dir>", "下載到哪個資料夾")
    .option("--no-board", "完成後不打開看板")
    .option("--json")
    .action((r, o) => cmdJoin(r, o));

  program.command("brief").description("跟我有關的變動").option("--peek", "只看，不記住已報告").option("--json").action((o) => cmdBrief(o));

  program
    .command("decide")
    .description("記錄一個決定（agent 用 --input - 傳 JSON）")
    .option("--input <file>", "JSON 檔，或 - 代表標準輸入")
    .option("--dry-run", "只印出內容，不寫入（回條用）")
    .option("--no-sync", "寫入後不同步")
    .option("--title <title>")
    .option("--decision <text>")
    .option("--why <text>")
    .option("--strength <strength>", "hard | preference | hunch | one-off")
    .option("--source <source>", "chat 或網址")
    .option("--area <area>")
    .option("--slug <slug>", "英文檔名")
    .option("--quote <text>", "使用者的原話（逐字）")
    .option("--supersedes <id>", "被取代的決定（可重複）", collect)
    .option("--json")
    .action((o) => cmdDecide(o));

  program
    .command("status")
    .description("更新我的狀態")
    .option("--input <file>", "JSON 檔，或 - 代表標準輸入")
    .option("--doing <text>")
    .option("--next <text>")
    .option("--blocked <text>", "空字串代表沒卡")
    .option("--fyi <text>", "要大家知道的（可重複，文字=參照）", collect)
    .option("--deliverable <title=url>", "成品（可重複）", collect)
    .option("--notes <text>")
    .option("--dry-run")
    .option("--no-sync")
    .option("--json")
    .action((o) => cmdStatus(o));

  program
    .command("ask <login>")
    .description("開一則等對方回應的問題")
    .requiredOption("--title <title>")
    .requiredOption("--body <body>")
    .option("--json")
    .action((l, o) => cmdAsk(l, o));
  program
    .command("disagree")
    .description("開一則分歧討論")
    .requiredOption("--with <login>")
    .requiredOption("--title <title>")
    .requiredOption("--body <body>", "你自己的立場")
    .option("--json")
    .action((o) => cmdDisagree(o));
  program
    .command("resolve <discussion>")
    .description("結束一則討論（可附上決定編號）")
    .option("--decision <id>")
    .option("--reason <reason>", "resolved | outdated | duplicate")
    .option("--json")
    .action((d, o) => cmdResolve(d, o));
  program
    .command("task <title>")
    .description("開一個任務")
    .option("--assign <login>", "指派（可重複）", collect)
    .option("--body <body>")
    .option("--json")
    .action((t, o) => cmdTask(t, o));

  program.command("sync").description("同步紀錄（通常自動進行）").option("--json").action((o) => cmdSync(o));
  program
    .command("check")
    .description("檢查紀錄格式")
    .option("--fix", "修正能自動修的問題")
    .option("--quiet")
    .option("--json")
    .action((o) => cmdCheck(o));
  program.command("doctor").description("檢查環境設定").option("--json").action((o) => cmdDoctor(o));
  program
    .command("hook <event>")
    .description("給 agent hook 用（session-start | stop | user-prompt | post-compact）")
    .option("--agent <agent>", "claude | codex")
    .action((e, o) => cmdHook(e, o));

  return program;
}

/** Read one line from stdin without keeping stdin open afterwards. */
function readLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString("utf8");
      const i = buf.indexOf("\n");
      if (i >= 0) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(buf.slice(0, i).trim());
      }
    };
    process.stdin.on("data", onData);
    process.stdin.once("end", () => (buf.trim() ? resolve(buf.trim()) : reject(new Error("沒有收到通行碼"))));
  });
}

export async function main(argv: string[]): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (e) {
    info(`✗ ${describeError(e)}`);
    process.exitCode = exitCodeFor(e);
  }
}
