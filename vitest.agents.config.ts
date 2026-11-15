import { defineConfig } from "vitest/config";

// Agent conformance tests: real agents, real usage. Run with `npm run test:agents`.
export default defineConfig({
  test: {
    include: ["tests/agents/**/*.agent.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
