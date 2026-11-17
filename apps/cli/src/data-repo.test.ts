/**
 * Team data in a separate repo (.tandem.json "dataRepo"): everything runs against local bare
 * repos standing in for GitHub; nothing here talks to the network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionInput } from "@tandem/contracts";
import { createDecision, headCommit, openGitDataStore, runGit, syncData, updateStatus } from "@tandem/core";
import { inviteLogin } from "./commands.ts";
import { assembleContext, type Context } from "./context.ts";
import { moveTeamData, renderMoveReport } from "./data-move.ts";
import { buildBoard, buildBrief } from "./gather.ts";
import { workChangedSince, workingTreePrint } from "./hook.ts";

let root: string;
let codeRemote: string;
let work: string;
let baseDir: string;

const git = async (cwd: string, ...args: string[]) => (await runGit(args, { cwd })).stdout;
const urlFor = (_owner: string, name: string) => path.join(root, `${name}.git`);
const code = { owner: "o", name: "code", url: "https://github.com/o/code" };
const noGh = { discussions: [], pullRequests: [], tasks: [], problems: [] };

async function bare(name: string): Promise<string> {
  const dir = path.join(root, `${name}.git`);
  fs.mkdirSync(dir);
  await runGit(["init", "--bare", "-q", "-b", "main"], { cwd: dir });
  return dir;
}

const decision = (title: string, slug: string): DecisionInput => ({
  title,
  slug,
  deciders: ["bob"],
  strength: "preference",
  source: "chat",
  quotes: [{ by: "bob", text: "就這樣", source: "chat" }],
  decision: `${title}。`,
  why: "比較簡單。",
});

async function context(gh: Partial<Context["gh"]> = {}, dataGh?: Partial<Context["gh"]>): Promise<Context> {
  const ctx = await assembleContext(
    { repoRoot: work, remote: code, gh: gh as Context["gh"], me: "alice", state: {} as Context["state"], token: "" },
    { gitEnv: {}, data: { baseDir, remoteUrlFor: urlFor } },
  );
  if (dataGh) ctx.dataGh = dataGh as Context["gh"];
  return ctx;
}

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-datarepo-")));
  baseDir = path.join(root, "app-data");
  codeRemote = await bare("code");
  work = path.join(root, "work");
  await runGit(["clone", "-q", codeRemote, work], { cwd: root });
  for (const [k, v] of [["user.name", "Alice"], ["user.email", "alice@example.com"], ["core.autocrlf", "false"]]) {
    await git(work, "config", k!, v!);
  }
  fs.writeFileSync(path.join(work, "README.md"), "code\n");
  await git(work, "checkout", "-q", "-B", "main");
  await git(work, "add", ".");
  await git(work, "commit", "-q", "-m", "init");
  await git(work, "push", "-q", "-u", "origin", "main");
  // An old decision that lives in the code repo (as before the move).
  await createDecision(openGitDataStore(work), decision("Old in code repo", "old-in-code"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

describe("same repo (no .tandem.json)", () => {
  it("keeps data in the code repo, as before", async () => {
    const ctx = await context();
    expect(ctx.dataRoot).toBe(work);
    expect(ctx.dataRepo).toEqual({ ...code, separate: false });
    expect(ctx.dataGh).toBeUndefined();
    const board = await buildBoard(ctx, noGh, { state: "idle" });
    expect(board.decisions.map((d) => d.frontmatter.title)).toEqual(["Old in code repo"]);
    expect(board.dataRepo?.url).toBe(board.repo.url);
    expect(fs.existsSync(baseDir)).toBe(false);
  });
});

describe("separate data repo", () => {
  beforeEach(async () => {
    await bare("data");
    fs.writeFileSync(path.join(work, ".tandem.json"), '{ "dataRepo": "o/data" }\n');
  });

  it("store, sync, brief and board use the data repo; code checks use the code repo", async () => {
    const ctx = await context();
    expect(ctx.dataRepo).toEqual({ owner: "o", name: "data", url: "https://github.com/o/data", separate: true });
    expect(ctx.dataRoot.startsWith(baseDir)).toBe(true);
    expect(ctx.store.repoRoot).toBe(ctx.dataRoot);

    const head = await headCommit(ctx.repoRoot);
    const tree = await workingTreePrint(ctx.repoRoot);
    const codeMain = (await git(codeRemote, "rev-parse", "main")).trim();

    // A teammate records a decision from another computer.
    const peer = await assembleContext(
      { repoRoot: work, remote: code, gh: {} as Context["gh"], me: "bob", state: {} as Context["state"], token: "" },
      { gitEnv: {}, data: { baseDir: path.join(root, "peer"), remoteUrlFor: urlFor } },
    );
    const d = await createDecision(peer.store, decision("New in data repo", "new-in-data"));
    expect(d.write?.result).toBe("pushed");
    await updateStatus(ctx.store, "alice", { doing: "moving data" });

    expect((await syncData(ctx.dataRoot, { gitEnv: ctx.gitEnv })).result).not.toBe("offline");
    const board = await buildBoard(ctx, noGh, { state: "idle" });
    expect(board.decisions.map((x) => x.frontmatter.title)).toEqual(["New in data repo"]);
    expect(board.members.find((m) => m.login === "alice")?.status?.doing).toBe("moving data");
    expect(board.repo.url).toBe("https://github.com/o/code");
    expect(board.dataRepo?.url).toBe("https://github.com/o/data");

    const { brief } = await buildBrief(ctx, noGh);
    expect(brief.repo).toEqual({ owner: "o", name: "code" });
    expect(brief.newDecisions.map((x) => x.url)).toEqual([`https://github.com/o/data/blob/HEAD/${d.path}`]);

    // Data writes leave the code repo (remote and working tree) alone.
    expect((await git(codeRemote, "rev-parse", "main")).trim()).toBe(codeMain);
    expect(await workChangedSince(ctx.repoRoot, head, tree)).toBe(false);
    fs.writeFileSync(path.join(work, "app.ts"), "export {};\n");
    expect(await workChangedSince(ctx.repoRoot, head, tree)).toBe(true);
  });

  it("invites to the code repo first, then the data repo, and reports both", async () => {
    const calls: string[] = [];
    const gh = { inviteCollaborator: async (l: string) => (calls.push(`code:${l}`), "invited" as const) };
    const ok = { inviteCollaborator: async (l: string) => (calls.push(`data:${l}`), "already" as const) };
    const r = await inviteLogin(await context(gh, ok), "bob");
    expect(calls).toEqual(["code:bob", "data:bob"]);
    expect(r.status).toBe("invited");
    expect(r.dataRepo).toEqual({ repo: "o/data", status: "already" });

    const failing = { inviteCollaborator: async () => Promise.reject(new Error("no admin")) };
    const r2 = await inviteLogin(await context(gh, failing), "carol");
    expect(r2.status).toBe("invited");
    expect(r2.dataRepo?.error).toContain("no admin");
  });
});

describe("tandem data move", () => {
  it("copies from the code repo's default branch, writes .tandem.json, and is a no-op the second time", async () => {
    const data = await bare("data");
    const ctx = await context();
    await updateStatus(ctx.store, "alice", { doing: "x" });
    await ctx.store.write([{ path: "tandem/team.md", content: "# team\n" }], "team");
    const opts = { data: { baseDir, remoteUrlFor: urlFor } };

    const dry = await moveTeamData(ctx, "o/data", { ...opts, dryRun: true });
    expect(dry.copy).toHaveLength(3);
    expect(dry.copy[0]).toMatch(/^tandem\/decisions\/.+\.md$/);
    expect(dry.copy.slice(1)).toEqual(["tandem/status/alice.md", "tandem/team.md"]);
    expect(dry.configWritten).toBeUndefined();
    expect(fs.existsSync(path.join(work, ".tandem.json"))).toBe(false);
    expect((await git(data, "for-each-ref")).trim()).toBe("");
    expect(renderMoveReport(dry).join("\n")).toContain("試跑");

    const r = await moveTeamData(ctx, "o/data", opts);
    expect(r.write?.result).toBe("pushed");
    expect(r.remove).toEqual(["tandem/decisions", "tandem/status", "tandem/team.md"]);
    expect(JSON.parse(fs.readFileSync(path.join(work, ".tandem.json"), "utf8"))).toEqual({ dataRepo: "o/data" });
    expect((await git(data, "rev-list", "--count", "main")).trim()).toBe("1");
    expect((await git(data, "ls-tree", "-r", "--name-only", "main")).trim().split("\n")).toEqual(dry.copy);
    // The code repo is untouched: files still there, nothing committed or pushed.
    expect((await git(codeRemote, "ls-tree", "-r", "--name-only", "main")).trim().split("\n")).toContain("tandem/team.md");
    expect((await git(work, "status", "--porcelain")).trim()).toBe("?? .tandem.json");
    const report = renderMoveReport(r).join("\n");
    expect(report).toContain("git rm -r -- tandem/decisions tandem/status tandem/team.md");
    expect(report).toContain("git add .tandem.json");
    expect(report).toContain("git 歷史");
    expect(report).toContain("force push");

    const again = await moveTeamData(ctx, "o/data", opts);
    expect(again.copy).toEqual([]);
    expect(again.same).toHaveLength(3);
    expect(again.write).toBeUndefined();
    expect((await git(data, "rev-list", "--count", "main")).trim()).toBe("1");

    // From now on this computer reads and writes the data repo.
    const after = await context();
    expect(after.dataRepo.separate).toBe(true);
    expect((await buildBoard(after, noGh, { state: "idle" })).decisions).toHaveLength(1);
  });

  it("refuses the code repo itself or a malformed name", async () => {
    const ctx = await context();
    await expect(moveTeamData(ctx, "o/code")).rejects.toMatchObject({ code: "usage" });
    await expect(moveTeamData(ctx, "nope")).rejects.toMatchObject({ code: "usage" });
  });
});
