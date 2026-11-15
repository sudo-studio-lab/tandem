// Release: npm run release -- 0.2.1 "這版改了什麼"
// Pushes the tag v0.2.1 (its message = the release notes). GitHub Actions
// (.github/workflows/release.yml) then builds the installer and uploads it to
// sudo-studio-lab/tandem-releases; installed apps pick it up on their next start.
//
// Fallback without GitHub Actions: add --local to build and upload from this computer
// (slow: the installer is ~150 MB). No tests here: run them while developing.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const local = args.includes("--local");
const [version, notes] = args.filter((a) => a !== "--local");
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !notes) {
  console.error('用法：npm run release -- 0.2.1 "這版改了什麼"  （加 --local 改在這台電腦打包上傳）');
  process.exit(1);
}
// npm is a .cmd on Windows and needs a shell; git and gh are real exes and get their args as-is.
const run = (cmd, a) => execFileSync(cmd, a, { stdio: "inherit", shell: cmd === "npm" && process.platform === "win32" });
const tag = `v${version}`;

if (!local) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
  if (dirty) {
    console.error("還有沒 commit 的修改。GitHub 只會打包已經 commit 的內容，請先 commit。");
    process.exit(1);
  }
  run("git", ["tag", "-a", tag, "-m", notes]);
  run("git", ["push", "origin", tag]);
  console.log(`\n已推送 ${tag}。GitHub 正在打包（約 10–15 分鐘），進度：gh run list -R sudo-studio-lab/tandem --workflow release`);
  process.exit(0);
}

for (const f of ["apps/desktop/package.json", "apps/cli/package.json"]) {
  const pkg = JSON.parse(readFileSync(f, "utf8"));
  pkg.version = version;
  writeFileSync(f, `${JSON.stringify(pkg, null, 2)}\n`);
}
run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--silent"]);
run("npm", ["run", "dist", "-w", "@tandem/desktop"]);
const dir = "apps/desktop/release";
const files = ["latest.yml", `Tandem-Setup-${version}.exe`, `Tandem-Setup-${version}.exe.blockmap`].map((f) => `${dir}/${f}`);
console.log("\n上傳到 tandem-releases（安裝檔約 150 MB，可能要十幾分鐘）…");
run("gh", ["release", "create", tag, "-R", "sudo-studio-lab/tandem-releases", "--target", "main", "--title", tag, "--notes", notes, ...files]);
console.log(`\n完成：${tag}。記得 commit 版本號（apps/*/package.json、package-lock.json）。`);
