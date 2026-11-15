import { cpSync, existsSync, rmSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { bin: "src/bin.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  // Bundle our workspace packages; keep npm dependencies external.
  noExternal: [/^@tandem\//],
  banner: { js: "#!/usr/bin/env node" },
  onSuccess: async () => {
    rmSync("dist/client", { recursive: true, force: true });
    if (existsSync("../web/dist")) cpSync("../web/dist", "dist/client", { recursive: true });
  },
});
