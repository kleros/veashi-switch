// The devnet:smoke driver's own vitest config: the default `test` include (src/**) never collects it.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    include: ["scripts/**/*.smoke.ts"],
    environment: "node",
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
