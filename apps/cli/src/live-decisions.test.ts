import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDecision, loadDecisions, openFsDataStore, type DataStore } from "@tandem/core";
import type { DecisionInput } from "@tandem/contracts";
import { CHECK_EVERY_MS, checkNewDecisions, rememberDecisions, type DecisionWatch } from "./live-decisions.ts";

let root: string;
let store: DataStore;

const START = new Date("2026-11-17T09:00:00");
const later = (ms: number) => new Date(START.getTime() + ms);

const input = (by: string, title: string, extra: Partial<DecisionInput> = {}): DecisionInput => ({
  title,
  deciders: [by],
  strength: "preference",
  source: "chat",
  quotes: [{ by, text: "就這樣", source: "chat" }],
  decision: `${title}。其他細節之後再說。`,
  why: "比較簡單。",
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x",
  ...extra,
});

async function add(by: string, title: string, at: Date, extra: Partial<DecisionInput> = {}) {
  const r = await createDecision(store, input(by, title, extra), { now: at });
  expect(r.problems.filter((p) => p.severity === "error")).toEqual([]);
  return r.id;
}

/** A session started at START that has seen what existed then (what session-start does). */
async function startSession(): Promise<DecisionWatch> {
  const s: DecisionWatch = { startedAt: START.toISOString(), decisionsCheckedAt: START.toISOString() };
  rememberDecisions(s, (await loadDecisions(store)).decisions, START);
  return s;
}

const check = (s: DecisionWatch, now: Date) => checkNewDecisions({ session: s, store, me: "alice", now });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tandem-live-"));
  store = openFsDataStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("decisions recorded mid-session", () => {
  it("tells about a teammate's new decision once", async () => {
    await add("bob", "Old one", later(-3600_000));
    const s = await startSession();
    const id = await add("bob", "Use Postgres", later(60_000));

    const note = await check(s, later(3 * 60_000));
    expect(note).toContain("隊友剛記了新的決定");
    expect(note).toContain(id);
    expect(note).toContain("Use Postgres — Use Postgres。");
    expect(note).toContain("@bob");
    expect(note).not.toContain("Old one");
    expect(note!.split("\n").length).toBeLessThanOrEqual(5);

    expect(await check(s, later(6 * 60_000))).toBeNull();
  });

  it("does not report my own decisions, but remembers them", async () => {
    const s = await startSession();
    const mine = await add("alice", "My call", later(60_000));
    expect(await check(s, later(3 * 60_000))).toBeNull();
    expect(s.seenDecisions).toContain(mine);
  });

  it("counts a decision made with me as a teammate's", async () => {
    const s = await startSession();
    await add("alice", "Shared call", later(60_000), { deciders: ["alice", "bob"] });
    expect(await check(s, later(3 * 60_000))).toContain("Shared call");
  });

  it("checks at most once every two minutes", async () => {
    const s = await startSession();
    await add("bob", "Too soon", later(10_000));
    expect(await check(s, later(CHECK_EVERY_MS - 1000))).toBeNull();
    // Throttled calls do not move the clock forward.
    expect(await check(s, later(CHECK_EVERY_MS + 1000))).toContain("Too soon");
    await add("bob", "Next one", later(CHECK_EVERY_MS + 2000));
    expect(await check(s, later(CHECK_EVERY_MS + 60_000))).toBeNull();
    expect(await check(s, later(2 * CHECK_EVERY_MS + 2000))).toContain("Next one");
  });

  it("includes superseding decisions and keeps the block short", async () => {
    const old = await add("bob", "First take", later(-3600_000));
    const s = await startSession();
    await add("bob", "Second take", later(30_000), { supersedes: [old] });
    for (const t of ["Third", "Fourth", "Fifth"]) await add("carol", t, later(40_000));
    const note = (await check(s, later(3 * 60_000)))!;
    expect(note.split("\n").length).toBeLessThanOrEqual(5);
    expect(note).toContain("還有 2 筆");
    const again = await check(s, later(6 * 60_000));
    expect(again).toBeNull();
  });

  it("a session without a baseline only takes one", async () => {
    await add("bob", "Before upgrade", later(-60_000));
    const s: DecisionWatch = { startedAt: START.toISOString() };
    expect(await check(s, later(60_000))).toBeNull();
    expect(s.seenDecisions?.length).toBe(1);
  });

  it("runs the sync before reading", async () => {
    const s = await startSession();
    let synced = false;
    const note = await checkNewDecisions({
      session: s,
      store,
      me: "alice",
      now: later(3 * 60_000),
      sync: async () => {
        synced = true;
        await add("bob", "Pulled in", later(2 * 60_000));
      },
    });
    expect(synced).toBe(true);
    expect(note).toContain("Pulled in");
  });
});
