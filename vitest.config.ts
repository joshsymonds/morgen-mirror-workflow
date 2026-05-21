import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // SDK-glue files can't be unit-tested locally — they depend on
      // morgen()'s server-side runtime injection. Their behavior is
      // observable only on Morgen's infrastructure post-deploy. The
      // orchestrator and lib/ files cover the tested logic.
      exclude: [
        "src/deploy.ts",
        "src/workflow.ts",
        "src/lib/morgen-client-adapter.ts",
        "src/**/*.types.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
