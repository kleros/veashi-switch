import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // The kleros-v2 submodule under contracts/ has HTML entries and sources of its own: the dev server crawls only this
  // app's entry for dependencies and does not watch contracts/.
  optimizeDeps: { entries: ["index.html"] },
  server: { host: "127.0.0.1", watch: { ignored: ["**/contracts/**"] } },
  preview: { host: "127.0.0.1" },
  build: { chunkSizeWarningLimit: 2000 },
  // Unit tests only (the src/data tests run in node); the Playwright e2e lives in e2e/ and is never collected.
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
});
