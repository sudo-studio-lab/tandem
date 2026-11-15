import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRODUCT } from "@tandem/contracts";
import { checkAgentIntegration, formatHookOutput, installAgentIntegration, readHookInput, removeAgentIntegration } from "./index.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tandem-agents-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const read = (rel: string) => readFile(join(dir, rel), "utf8");
const exists = (rel: string) => stat(join(dir, rel)).then(() => true, () => false);
async function put(rel: string, text: string) {
  await mkdir(join(dir, rel, ".."), { recursive: true });
  await writeFile(join(dir, rel), text, "utf8");
}
async function listAll(prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listAll(rel)));
    else out.push(rel);
  }
  return out.sort();
}

describe("install: fresh repo", () => {
  it("creates everything and is idempotent", async () => {
    const first = await installAgentIntegration(dir);
    expect(first.every((c) => c.action === "create")).toBe(true);
    expect(await read("CLAUDE.md")).toBe("@AGENTS.md\n");

    const agents = await read("AGENTS.md");
    expect(agents).toMatch(/^<!-- BEGIN TANDEM v:1 hash:[0-9a-f]{8} -->\n## Tandem（團隊協作）/);
    expect(agents).toContain("`tandem brief`");
    expect(agents.trimEnd().endsWith("<!-- END TANDEM -->")).toBe(true);

    const claude = JSON.parse(await read(".claude/settings.json"));
    expect(claude.hooks.SessionStart).toEqual([
      { matcher: "startup|resume|clear|compact", hooks: [{ type: "command", command: "tandem hook session-start --agent claude", timeout: 30 }] },
    ]);
    expect(claude.hooks.Stop[0].hooks[0].command).toBe("tandem hook stop --agent claude");
    expect(claude.hooks.Stop[0].matcher).toBeUndefined();

    const codex = JSON.parse(await read(".codex/hooks.json"));
    expect(Object.keys(codex.hooks).sort()).toEqual(["PostCompact", "SessionStart", "Stop", "UserPromptSubmit"]);
    expect(codex.hooks.SessionStart[0].matcher).toBe("startup|resume|clear");
    const h = codex.hooks.UserPromptSubmit[0].hooks[0];
    expect(h.command).toBe("tandem hook user-prompt --agent codex");
    expect(h.commandWindows).toBe(h.command);

    for (const root of [".claude/skills", ".agents/skills"]) {
      for (const n of ["decision", "status", "ask"]) {
        const text = await read(`${root}/tandem-${n}/SKILL.md`);
        expect(text).toMatch(new RegExp(`^---\\nname: tandem-${n}\\ndescription: ".+"\\n---\\n`));
        expect(text.trimEnd().endsWith("<!-- tandem-skill v:1 -->")).toBe(true);
        expect(text.split("\n").length).toBeLessThan(120);
      }
    }
    expect(await read(".claude/skills/tandem-decision/SKILL.md")).toBe(await read(".agents/skills/tandem-decision/SKILL.md"));
    expect(await read(".claude/skills/tandem-decision/SKILL.md")).toContain("我記成這樣，對嗎？");

    const second = await installAgentIntegration(dir);
    expect(second.every((c) => c.action === "unchanged")).toBe(true);
    expect(second.length).toBe(first.length);
  });

  it("dry run writes nothing", async () => {
    const changes = await installAgentIntegration(dir, { dryRun: true });
    expect(changes.every((c) => c.action === "create")).toBe(true);
    expect(await listAll()).toEqual([]);
  });

  it("uses PRODUCT.markerName in the marker", async () => {
    await installAgentIntegration(dir);
    expect(await read("AGENTS.md")).toContain(`<!-- BEGIN ${PRODUCT.markerName} v:1`);
  });
});

describe("install: existing files", () => {
  it("keeps CRLF AGENTS.md content and CLAUDE.md content", async () => {
    const agentsOrig = "# Project\r\n\r\nSome rules.\r\n";
    const claudeOrig = "# Mine\n\nHello\n";
    await put("AGENTS.md", agentsOrig);
    await put("CLAUDE.md", claudeOrig);
    await installAgentIntegration(dir);

    const agents = await read("AGENTS.md");
    expect(agents).not.toMatch(/[^\r]\n/);
    expect(agents.startsWith("<!-- BEGIN TANDEM v:1")).toBe(true);
    expect(agents.endsWith(agentsOrig)).toBe(true);
    expect(await read("CLAUDE.md")).toBe(`<!-- BEGIN TANDEM -->\n@AGENTS.md\n<!-- END TANDEM -->\n${claudeOrig}`);

    expect((await installAgentIntegration(dir)).every((c) => c.action === "unchanged")).toBe(true);
  });

  it("does not touch CLAUDE.md that already imports AGENTS.md", async () => {
    await put("CLAUDE.md", "intro\n@AGENTS.md\nmore\n");
    const changes = await installAgentIntegration(dir);
    expect(changes.find((c) => c.path === "CLAUDE.md")?.action).toBe("unchanged");
    expect(await read("CLAUDE.md")).toBe("intro\n@AGENTS.md\nmore\n");
  });

  it("replaces an existing block in place without altering outside text", async () => {
    await put("AGENTS.md", "top\n\n<!-- BEGIN TANDEM v:0 hash:deadbeef -->\nold\n<!-- END TANDEM -->\n\nbottom\n");
    await installAgentIntegration(dir);
    const text = await read("AGENTS.md");
    expect(text.startsWith("top\n\n<!-- BEGIN TANDEM v:1 hash:")).toBe(true);
    expect(text.endsWith("<!-- END TANDEM -->\n\nbottom\n")).toBe(true);
    expect(text).not.toContain("old");
    expect(text.match(/BEGIN TANDEM/g)?.length).toBe(1);
  });

  it("merges into settings.json without dropping keys or other hooks", async () => {
    const original = {
      permissions: { allow: ["Bash(ls)"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
        Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }],
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              { type: "command", command: "tandem hook session-start --agent old" },
              { type: "command", command: "echo keep" },
            ],
          },
        ],
      },
      model: "x",
    };
    await put(".claude/settings.json", JSON.stringify(original, null, 2) + "\n");
    await installAgentIntegration(dir);
    const s = JSON.parse(await read(".claude/settings.json"));
    expect(s.permissions).toEqual(original.permissions);
    expect(s.model).toBe("x");
    expect(s.hooks.PreToolUse).toEqual(original.hooks.PreToolUse);
    expect(s.hooks.Stop[0]).toEqual(original.hooks.Stop[0]);
    expect(s.hooks.Stop).toHaveLength(2);
    const cmds = s.hooks.SessionStart.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds).toEqual(["echo keep", "tandem hook session-start --agent claude"]);
    expect((await read(".claude/settings.json")).startsWith('{\n  "permissions"')).toBe(true);

    expect((await installAgentIntegration(dir)).every((c) => c.action === "unchanged")).toBe(true);
  });

  it("refuses to overwrite invalid JSON", async () => {
    await put(".claude/settings.json", "{ not json");
    await expect(installAgentIntegration(dir)).rejects.toThrow(/JSON/);
    expect(await exists("AGENTS.md")).toBe(false);
  });
});

describe("check", () => {
  it("reports missing, current, stale", async () => {
    let items = await checkAgentIntegration(dir);
    expect(items.every((i) => i.state === "missing")).toBe(true);

    await installAgentIntegration(dir);
    items = await checkAgentIntegration(dir);
    expect(items.every((i) => i.state === "current")).toBe(true);
    expect(items.length).toBe(1 + 1 + 2 + 4 + 6);

    await put("AGENTS.md", (await read("AGENTS.md")).replace("v:1", "v:0"));
    await put(".codex/hooks.json", (await read(".codex/hooks.json")).replace("--agent codex", "--agent codex --old"));
    await put(".agents/skills/tandem-ask/SKILL.md", (await read(".agents/skills/tandem-ask/SKILL.md")).replace("v:1", "v:0"));
    await rm(join(dir, ".claude/skills/tandem-status"), { recursive: true });
    items = await checkAgentIntegration(dir);
    const by = (p: string) => items.filter((i) => i.path === p).map((i) => i.state);
    expect(by("AGENTS.md")).toEqual(["stale"]);
    expect(by(".codex/hooks.json")).toContain("stale");
    expect(by(".agents/skills/tandem-ask/SKILL.md")).toEqual(["stale"]);
    expect(by(".claude/skills/tandem-status/SKILL.md")).toEqual(["missing"]);

    await installAgentIntegration(dir);
    expect((await checkAgentIntegration(dir)).every((i) => i.state === "current")).toBe(true);
  });
});

describe("remove", () => {
  it("removes everything Tandem created in a fresh repo", async () => {
    await installAgentIntegration(dir);
    const changes = await removeAgentIntegration(dir);
    expect(changes.every((c) => c.action === "update")).toBe(true);
    expect(await listAll()).toEqual([]);
    expect((await removeAgentIntegration(dir)).every((c) => c.action === "unchanged")).toBe(true);
  });

  it("restores existing files byte for byte", async () => {
    const files: Record<string, string> = {
      "AGENTS.md": "# Project\r\n\r\nSome rules.\r\n",
      "CLAUDE.md": "# Mine\n\nHello\n",
      ".claude/settings.json":
        JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } }, null, 2) + "\n",
      ".codex/hooks.json": JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo x" }] }] } }, null, 2) + "\n",
      "other.txt": "untouched\n",
    };
    for (const [k, v] of Object.entries(files)) await put(k, v);
    await installAgentIntegration(dir);
    await removeAgentIntegration(dir);
    for (const [k, v] of Object.entries(files)) expect(await read(k)).toBe(v);
    expect(await listAll()).toEqual(Object.keys(files).sort());
  });

  it("keeps settings.json (minus Tandem) when it had other keys, and leaves a user CLAUDE.md import alone", async () => {
    await put(".claude/settings.json", '{\n  "model": "x"\n}\n');
    await put("CLAUDE.md", "@AGENTS.md\nmine\n");
    await installAgentIntegration(dir);
    await removeAgentIntegration(dir);
    expect(await read(".claude/settings.json")).toBe('{\n  "model": "x"\n}\n');
    expect(await read("CLAUDE.md")).toBe("@AGENTS.md\nmine\n");
  });

  it("keeps CLAUDE.md if the user edited what Tandem created", async () => {
    await installAgentIntegration(dir);
    await put("CLAUDE.md", "@AGENTS.md\nextra\n");
    await removeAgentIntegration(dir);
    expect(await read("CLAUDE.md")).toBe("@AGENTS.md\nextra\n");
  });
});

describe("hook output", () => {
  const events = ["session-start", "stop", "user-prompt", "post-compact"] as const;
  it("session-start and user-prompt carry additionalContext for both agents", () => {
    for (const agent of ["claude", "codex"] as const) {
      expect(JSON.parse(formatHookOutput(agent, "session-start", { context: "hi" }))).toEqual({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "hi" },
      });
      expect(JSON.parse(formatHookOutput(agent, "user-prompt", { context: "hi" }))).toEqual({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "hi" },
      });
    }
  });
  it("stop blocks with reason, otherwise allows with valid JSON", () => {
    for (const agent of ["claude", "codex"] as const) {
      expect(JSON.parse(formatHookOutput(agent, "stop", { blockReason: "更新狀態" }))).toEqual({ decision: "block", reason: "更新狀態" });
      expect(JSON.parse(formatHookOutput(agent, "stop", {}))).toEqual({});
    }
  });
  it("always emits a single JSON object", () => {
    for (const agent of ["claude", "codex"] as const)
      for (const ev of events)
        for (const p of [{}, { context: "c" }, { blockReason: "b" }]) {
          expect(typeof JSON.parse(formatHookOutput(agent, ev, p))).toBe("object");
        }
    expect(formatHookOutput("codex", "post-compact", { context: "ignored" })).toBe("{}");
    expect(formatHookOutput("claude", "session-start", {})).toBe("{}");
  });
});

describe("readHookInput", () => {
  it("parses Claude and Codex shapes", () => {
    const a = readHookInput(JSON.stringify({ session_id: "s1", source: "resume", stop_hook_active: true, last_assistant_message: "done" }));
    expect(a).toMatchObject({ sessionId: "s1", source: "resume", stopHookActive: true, lastAssistantMessage: "done" });
    const b = readHookInput(JSON.stringify({ session_id: "s2", turn_id: "t", stop_hook_active: false, last_assistant_message: null }));
    expect(b.sessionId).toBe("s2");
    expect(b.stopHookActive).toBe(false);
    expect(b.lastAssistantMessage).toBeUndefined();
  });
  it("tolerates garbage and BOM", () => {
    expect(readHookInput("").raw).toBeNull();
    expect(readHookInput("not json").raw).toBeNull();
    expect(readHookInput("﻿" + '{"session_id":"x"}').sessionId).toBe("x");
    expect(readHookInput("[1]").sessionId).toBeUndefined();
  });
});
