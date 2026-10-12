import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: { chunkSizeWarningLimit: 2000 },
  // Unit tests only (the chain lane's src/data tests run in node); the Playwright e2e lives in e2e/ and is never collected.
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
});
