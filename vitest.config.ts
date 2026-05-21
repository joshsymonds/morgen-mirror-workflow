import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The deployment artifact (workflow.ts) and CLI (deploy.ts)
      // can't be unit-tested locally — they reference morgen() and
      // luxon as V8-injected globals only present inside Morgen's
      // server-side isolate. The pure logic is covered by the
      // src/lib/* modules and their tests; workflow.ts hand-mirrors
      // those for the V8 deployment path.
      exclude: ["src/deploy.ts", "src/workflow.ts", "src/**/*.types.ts"],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
