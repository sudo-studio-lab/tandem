import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TandemError, validateContextPath, type ContextConflict } from "@tandem/contracts";
import { runGit } from "../git/run.ts";
import { makeFixture, type Fixture } from "../git/test-helpers.ts";
import { openFsDataStore, openGitDataStore } from "../data/index.ts";
import { deleteContext, listContext, notesHead, readContext, writeContext } from "./context.ts";
import { describeSecrets, findSecrets } from "./secrets.ts";

/** Smallest valid PNG header plus a few bytes; enough for the type check. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0, 1, 2, 3, 255, 254])]);

async function caught(p: Promise<unknown>): Promise<TandemError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof TandemError) return e;
    throw e;
  }
  throw new Error("expected a TandemError");
}

describe("context paths", () => {
  it("accepts relative paths of allowed types up to three levels", () => {
    expect(validateContextPath("notes.md")).toBe("notes.md");
    expect(validateContextPath("./specs/api.md")).toBe("specs/api.md");
    expect(validateContextPath("tandem/context/a/b/flow.mmd")).toBe("a/b/flow.mmd");
    expect(validateContextPath("設計/畫面.png")).toBe("設計/畫面.png");
    expect(validateContextPath("specs\\data.json")).toBe("specs/data.json");
  });

  it.each([
    ["../secrets.md", ".."],
    ["a/../b.md", ".."],
    ["/etc/passwd.txt", "相對路徑"],
    ["C:/x.md", "相對路徑"],
    ["a/b/c/d.md", "3 層"],
    ["run.exe", "只收"],
    ["noext", "只收"],
    [".hidden.md", "不能用 . 開頭"],
    ["has space.md", "不能有空白"],
    ["a//b.md", "空的資料夾"],
    ["", "要給檔名"],
  ])("rejects %s", (p, why) => {
    expect(() => validateContextPath(p)).toThrow(why);
  });
});

describe("secret guard", () => {
  // Fake values built at runtime so no key-shaped string is committed.
  const rnd = (n: number) => "a1B2c3D4e5F6g7H8".repeat(8).slice(0, n);
  const cases: [string, string][] = [
    ["GitHub token", `token is ${"gh" + "p_"}${rnd(36)}`],
    ["GitHub token", `${"github" + "_pat_"}${rnd(40)}`],
    ["Anthropic API key", `key: ${"sk-" + "ant-"}${rnd(40)}`],
    ["OpenAI API key", `use ${"sk-" + "proj-"}${rnd(40)}`],
    ["AWS access key", `id ${"AK" + "IA"}${"ABCDEFGHIJ234567"}`],
    ["私鑰（PEM）", `-----${"BEGIN"} RSA ${"PRIVATE"} KEY-----`],
    ["金鑰設定（KEY=…）", `MY_SERVICE_${"API_KEY"}=${rnd(32)}`],
    ["金鑰設定（KEY=…）", `  "client_${"secret"}": "${rnd(24)}"`],
    ["網址裡的密碼", `postgres://app:${rnd(12)}@db.internal:5432/app`],
  ];
  it.each(cases)("finds %s", (kind, line) => {
    const hits = findSecrets(`hello\n${line}\nbye`);
    expect(hits).toEqual([{ kind, line: 2 }]);
  });

  it("leaves ordinary text, placeholders and short values alone", () => {
    const text = [
      "# 架構",
      "API_KEY=your-api-key-here",
      "OPENAI_API_KEY=${OPENAI_API_KEY}",
      "TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx",
      "PASSWORD=short1",
      "DEBUG=true",
      "SITE_URL=https://example.com/a/very/long/path/1234567890",
      "commit 4b825dc642cb6eb9a060e54bf8d69288fbee4904 changed the token flow",
      "postgres://user:password@localhost/db",
      "scikit uses sk-learn",
    ].join("\n");
    expect(findSecrets(text)).toEqual([]);
  });

  it("describes hits without echoing the value", () => {
    const value = `${"gh" + "p_"}${rnd(36)}`;
    const msg = describeSecrets(findSecrets(value))!;
    expect(msg).toContain("第 1 行：GitHub token");
    expect(msg).not.toContain(value);
    expect(describeSecrets([])).toBeNull();
  });
});

describe("context on a folder store", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ctx-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("writes, lists (notes.md first), reads, and deletes", async () => {
    const store = openFsDataStore(root);
    await writeContext(store, { path: "specs/api.md", content: "# API\n" }, { me: "alice" });
    const w = await writeContext(store, { path: "notes.md", content: "# 背景\n第二行\n" }, { me: "alice" });
    expect(w.result).toBe("pushed");
    await writeContext(store, { path: "img/logo.png", content: PNG.toString("base64"), encoding: "base64" }, { me: "alice" });
    expect(fs.readFileSync(path.join(root, "tandem/context/img/logo.png")).equals(PNG)).toBe(true);

    const list = await listContext(store);
    expect(list.map((f) => f.path)).toEqual(["notes.md", "img/logo.png", "specs/api.md"]);
    expect(list.find((f) => f.path === "img/logo.png")).toMatchObject({ kind: "image", mime: "image/png", size: PNG.length });

    const notes = await readContext(store, "notes.md");
    expect(notes).toMatchObject({ content: "# 背景\n第二行\n", encoding: "utf8", version: w.version });
    const img = await readContext(store, "img/logo.png");
    expect(img).toMatchObject({ encoding: "base64", content: PNG.toString("base64") });
    expect(await readContext(store, "missing.md")).toBeNull();
    expect(await notesHead(store)).toBe("# 背景\n第二行");

    await deleteContext(store, "specs/api.md", { me: "alice" });
    expect((await listContext(store)).map((f) => f.path)).toEqual(["notes.md", "img/logo.png"]);
  });

  it("refuses stale versions, bad content, secrets and oversized files", async () => {
    const store = openFsDataStore(root);
    const v1 = await writeContext(store, { path: "notes.md", content: "one\n", expectVersion: null }, { me: "alice" });
    // expectVersion null means "create only".
    const dup = await caught(writeContext(store, { path: "notes.md", content: "x\n", expectVersion: null }, { me: "bob" }));
    expect(dup.code).toBe("conflict");
    const v2 = await writeContext(store, { path: "notes.md", content: "two\n", expectVersion: v1.version }, { me: "bob" });
    const stale = await caught(writeContext(store, { path: "notes.md", content: "three\n", expectVersion: v1.version }, { me: "alice" }));
    expect(stale.code).toBe("conflict");
    expect((stale.details as ContextConflict).version).toBe(v2.version);
    expect(fs.readFileSync(path.join(root, "tandem/context/notes.md"), "utf8")).toBe("two\n");
    expect((await caught(deleteContext(store, "notes.md", { me: "alice", expectVersion: v1.version! }))).code).toBe("conflict");

    const secret = `GH_TOKEN=${"gh" + "p_"}${"Zz9".repeat(13)}`;
    const s = await caught(writeContext(store, { path: "env.txt", content: `ok\n${secret}\n` }, { me: "alice" }));
    expect(s.code).toBe("validation");
    expect(s.message).toContain("第 2 行");
    expect(s.message).not.toContain(secret);
    expect(fs.existsSync(path.join(root, "tandem/context/env.txt"))).toBe(false);

    expect((await caught(writeContext(store, { path: "a.png", content: "not an image" }, { me: "a" }))).message).toContain("base64");
    expect(
      (await caught(writeContext(store, { path: "a.png", content: Buffer.from("GIF89a....").toString("base64"), encoding: "base64" }, { me: "a" })))
        .message,
    ).toContain("PNG");
    const big = "x".repeat(2 * 1024 * 1024 + 1);
    expect((await caught(writeContext(store, { path: "big.txt", content: big }, { me: "a" }))).message).toContain("2 MB");
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x01]).toString("base64");
    expect((await caught(writeContext(store, { path: "b.txt", content: binary, encoding: "base64" }, { me: "a" }))).message).toContain("UTF-8");
  });
});

describe("context on the git data store", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await makeFixture();
  });
  afterEach(() => fx.cleanup());

  it("records the author in the commit message and lists who changed what", async () => {
    const a = openGitDataStore(fx.a);
    await writeContext(a, { path: "notes.md", content: "# 背景\n", why: "整理背景\n第二行" }, { me: "alice" });
    await writeContext(a, { path: "shots/home.png", content: PNG.toString("base64"), encoding: "base64" }, { me: "alice" });
    const log = (await runGit(["log", "-2", "--format=%B%x00", "main"], { cwd: fx.remote })).stdout;
    expect(log).toContain("tandem: context shots/home.png (@alice)");
    expect(log).toContain("tandem: context notes.md (@alice)\n\n原因：整理背景 第二行");
    // Binary content survives the round trip through git.
    expect((await runGitBytesShow(fx.remote, "main:tandem/context/shots/home.png")).equals(PNG)).toBe(true);

    const b = openGitDataStore(fx.b);
    await runGit(["fetch", "origin"], { cwd: fx.b });
    const list = await listContext(b);
    expect(list.map((f) => [f.path, f.by])).toEqual([
      ["notes.md", "alice"],
      ["shots/home.png", "alice"],
    ]);
    const img = await readContext(b, "shots/home.png");
    expect(Buffer.from(img!.content, "base64").equals(PNG)).toBe(true);
  });

  it("a write based on an old version is refused even when the check only happens at push time", async () => {
    const a = openGitDataStore(fx.a);
    const b = openGitDataStore(fx.b);
    const first = await writeContext(a, { path: "notes.md", content: "one\n" }, { me: "alice" });
    await runGit(["fetch", "origin"], { cwd: fx.b });
    const seen = await readContext(b, "notes.md");
    expect(seen!.version).toBe(first.version);

    // A changes it again; B has not fetched, so B's local check passes and only the push-time check can catch it.
    await writeContext(a, { path: "notes.md", content: "two\n", expectVersion: first.version }, { me: "alice" });
    const err = await caught(writeContext(b, { path: "notes.md", content: "mine\n", expectVersion: seen!.version }, { me: "bob" }));
    expect(err.code).toBe("conflict");
    expect(err.message).toBe("這個檔案剛被 @alice 改過，請重新載入再改");
    expect((await runGit(["show", "main:tandem/context/notes.md"], { cwd: fx.remote })).stdout).toBe("two\n");
    expect(await b.pending()).toBe(0);

    // After reloading, B's write goes through.
    const fresh = await readContext(b, "notes.md");
    const ok = await writeContext(b, { path: "notes.md", content: "two\nmine\n", expectVersion: fresh!.version }, { me: "bob" });
    expect(ok.result).toBe("pushed");
    expect((await listContext(a))[0]).toMatchObject({ path: "notes.md" });
  });
});

async function runGitBytesShow(cwd: string, spec: string): Promise<Buffer> {
  const { runGitBytes } = await import("../git/run.ts");
  return (await runGitBytes(["cat-file", "blob", spec], { cwd })).stdout;
}
