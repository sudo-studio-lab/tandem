// Bundles the Electron main process and preload into dist/ (CJS). Everything except `electron`
// is bundled, so the packaged app needs no node_modules.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs" });
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs" });
