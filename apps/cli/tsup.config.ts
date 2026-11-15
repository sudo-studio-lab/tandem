import { cpSync, existsSync, rmSync } from "node:fs";
import { defineConfig, type Options } from "tsup";

const copyClient = (outDir: string) => () => {
  rmSync(`${outDir}/client`, { recursive: true, force: true });
  if (existsSync("../web/dist")) cpSync("../web/dist", `${outDir}/client`, { recursive: true });
};

const common: Options = {
  entry: { bin: "src/bin.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
};

export default defineConfig([
  // npm / `npm link` build: bundle our workspace packages, keep npm dependencies external.
  {
    ...common,
    outDir: "dist",
    noExternal: [/^@tandem\//],
    banner: { js: "#!/usr/bin/env node" },
    onSuccess: async () => copyClient("dist")(),
  },
  // Desktop build: one self-contained file run by Electron's Node.
  // Everything is inlined except the native keyring module, which ships next to it.
  {
    ...common,
    outDir: "dist-desktop",
    outExtension: () => ({ js: ".mjs" }),
    noExternal: [/^(?!@napi-rs\/keyring)/],
    external: ["@napi-rs/keyring"],
    splitting: false,
    // Some CommonJS dependencies call require(); give the ESM bundle a real one.
    banner: {
      js: 'import { createRequire as __tandemCreateRequire } from "node:module"; const require = __tandemCreateRequire(import.meta.url);',
    },
    onSuccess: async () => copyClient("dist-desktop")(),
  },
]);
