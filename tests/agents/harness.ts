/**
 * Drives a real agent through Tandem's own adapters (the same code the app uses) against a
 * throwaway repo whose records live in a local folder. Costs real usage, so it only runs via
 * `npm run test:agents`.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentKind, ApprovalDecision } from "@tandem/contracts";
import { createDecision, openFsDataStore, updateStatus } from "@tandem/core";
import { ADAPTERS } from "../../apps/cli/src/agents/index.ts";
import type { AdapterEvent, AgentSession, ApprovalRequest } from "../../apps/cli/src/agents/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../../apps/cli/dist/bin.js");
export const ME = "alice";

export interface Turn {
  text: string;
  tools: { name: string; input: unknown }[];
  approvals: ApprovalRequest[];
  errors: string[];
  costUsd: number;
}

export type Policy = (req: ApprovalRequest) => ApprovalDecision;
export const denyAll: Policy = () => "deny";

export class Harness {
  readonly dir: string;
  private session!: AgentSession;
  private bridge?: http.Server;
  private current: Turn | null = null;
  private done: (() => void) | null = null;
  readonly turns: Turn[] = [];
  /** Everything the user said, in order. */
  readonly said: string[] = [];
  policy: Policy = denyAll;

  private constructor(readonly agent: AgentKind, dir: string) {
    this.dir = dir;
  }

  static async create(agent: AgentKind, model: string): Promise<Harness> {
    // Keep the adapters' per-chat files out of the user's real Tandem folder.
    process.env.TANDEM_HOME ??= await mkdtemp(path.join(tmpdir(), "tandem-conf-home-"));
    const dir = await mkdtemp(path.join(tmpdir(), `tandem-conf-${agent}-`));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    const h = new Harness(agent, dir);
    await h.start(model);
    return h;
  }

  get store() {
    return openFsDataStore(this.dir);
  }

  private async start(model: string) {
    let approveBridge: { url: string; token: string } | undefined;
    if (this.agent === "claude") {
      const token = randomBytes(16).toString("hex");
      this.bridge = http.createServer((req, res) => {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          const ok = req.headers.authorization === `Bearer ${token}`;
          const j = ok ? (JSON.parse(body) as { toolName: string; input: unknown }) : null;
          const d = j ? this.approve({ name: j.toolName, summary: "", input: j.input }) : "deny";
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(d === "deny" ? { allow: false, message: "使用者拒絕了這個動作。" } : { allow: true }));
        });
      });
      await new Promise<void>((r) => this.bridge!.listen(0, "127.0.0.1", r));
      const port = (this.bridge.address() as { port: number }).port;
      approveBridge = { url: `http://127.0.0.1:${port}/approve`, token };
    }
    this.session = ADAPTERS[this.agent].start({
      chatId: `conf-${randomBytes(4).toString("hex")}`,
      cwd: this.dir,
      model,
      mcp: { command: process.execPath, args: [CLI, "mcp"], env: { TANDEM_TEST_ROOT: this.dir, TANDEM_TEST_ME: ME } },
      approveBridge,
      requestApproval: async (req) => this.approve(req),
      onEvent: (e) => this.onEvent(e),
    });
  }

  private approve(req: ApprovalRequest): ApprovalDecision {
    this.current?.approvals.push(req);
    return this.policy(req);
  }

  private onEvent(e: AdapterEvent) {
    const t = this.current;
    if (!t) return;
    if (e.type === "message") t.text += `${e.text}\n`;
    if (e.type === "tool" && e.status === "running" && e.name) t.tools.push({ name: e.name, input: e.input });
    if (e.type === "error") t.errors.push(e.message);
    if (e.type === "turnDone") {
      t.costUsd += e.costUsd ?? 0;
      this.done?.();
    }
    if (e.type === "exit") this.done?.();
  }

  /** Send one message and wait for the agent to finish (or `stopAfterMs` to interrupt it). */
  async say(text: string, opts: { stopAfterMs?: number; timeoutMs?: number } = {}): Promise<Turn> {
    const turn: Turn = { text: "", tools: [], approvals: [], errors: [], costUsd: 0 };
    this.current = turn;
    this.turns.push(turn);
    this.said.push(text);
    const finished = new Promise<void>((r) => (this.done = r));
    await this.session.send(text);
    if (opts.stopAfterMs) {
      await new Promise((r) => setTimeout(r, opts.stopAfterMs));
      await this.session.interrupt();
    }
    await Promise.race([finished, new Promise((_, rej) => setTimeout(() => rej(new Error("agent 沒有在時間內回覆")), opts.timeoutMs ?? 240_000))]);
    this.done = null;
    return turn;
  }

  /** Tool calls whose name contains `part` (Claude: mcp__tandem__x, Codex: tandem.x). */
  calls(part: string, turn?: Turn): { name: string; input: any }[] {
    return (turn ? [turn] : this.turns).flatMap((t) => t.tools).filter((c) => c.name.includes(part));
  }

  async decisionFiles(): Promise<string[]> {
    return readdir(path.join(this.dir, "tandem/decisions")).catch(() => []);
  }

  async read(rel: string): Promise<string | null> {
    return readFile(path.join(this.dir, rel), "utf8").catch(() => null);
  }

  async ghCalls(): Promise<{ kind: string; input: any }[]> {
    const t = await this.read(".gh-calls.jsonl");
    return (t ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }

  cost(): number {
    return this.turns.reduce((n, t) => n + t.costUsd, 0);
  }

  async close() {
    await this.session.close().catch(() => undefined);
    this.bridge?.close();
    await rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A seeded decision everyone in the scenarios refers to. */
export async function seedDecision(h: Harness, over: Partial<Parameters<typeof createDecision>[1]> = {}): Promise<string> {
  const r = await createDecision(h.store, {
    title: "資料庫用 SQLite",
    decision: "第一版的資料庫用 SQLite。",
    why: "部署簡單，資料量小。",
    strength: "preference",
    deciders: ["roy"],
    source: "chat",
    quotes: [{ by: "roy", text: "資料庫先用sqlite就好", source: "chat" }],
    supersedes: [],
    ...over,
  } as Parameters<typeof createDecision>[1]);
  return r.id!;
}

export async function seedStatus(h: Harness, login: string, doing: string) {
  await updateStatus(h.store, login, { doing }, {});
}
