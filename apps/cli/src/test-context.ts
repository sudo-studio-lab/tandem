/**
 * Offline context for tests and the agent conformance runner (plan "相容性測試"): records live in a
 * local folder (openFsDataStore) and GitHub calls are appended to <root>/.gh-calls.jsonl instead of
 * being sent. Only used when `tandem mcp` runs with TANDEM_TEST_ROOT set; never touches GitHub.
 */
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { openFsDataStore } from "@tandem/core";
import type { Context } from "./context.ts";

export function offlineContext(root: string, me: string): Context {
  let n = 0;
  const record = async (kind: string, input: unknown) => {
    n += 1;
    await appendFile(path.join(root, ".gh-calls.jsonl"), `${JSON.stringify({ kind, input })}\n`, "utf8");
    return { number: n, url: `https://github.com/test/test/${kind === "issue" ? "issues" : "discussions"}/${n}` };
  };
  const gh = {
    createDiscussion: (input: unknown) => record("discussion", input),
    createIssue: (input: unknown) => record("issue", input),
  };
  return {
    repoRoot: root,
    remote: { owner: "test", name: "test", url: "https://github.com/test/test" },
    gh: gh as unknown as Context["gh"],
    me,
    state: {} as Context["state"],
    saveState: async () => {},
    token: "",
    gitEnv: {},
    dataRoot: root,
    dataRepo: { owner: "test", name: "test", url: "https://github.com/test/test", separate: false },
    store: openFsDataStore(root),
  };
}
