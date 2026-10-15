import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The web server's port is chosen once in the runner and handed to the workers through the environment.
function freePort(): string {
  return execFileSync(
    process.execPath,
    ["-e", "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"],
    { encoding: "utf8" },
  ).trim();
}
process.env.VEASHI_E2E_WEB_PORT ||= freePort();
const port = process.env.VEASHI_E2E_WEB_PORT;
const baseURL = `http://127.0.0.1:${port}`;

// VEASHI_E2E_FAKE=1 runs the same specs against `vite --mode fake` (in-memory data, no chain): a development aid only.
// The default is the real thing: scripts/serve-critique.sh starts the devnet on
// free ports with its relayer, builds the app against the fresh devnet.json and serves dist/; SIGTERM stops it all.
const fake = process.env.VEASHI_E2E_FAKE === "1";
const viteBin = fake ? join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin", "vite.js") : "";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 60_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    screenshot: "off",
    video: "off",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: fake
      ? `node ${viteBin} --mode fake --host 127.0.0.1 --port ${port} --strictPort`
      : "bash scripts/serve-critique.sh",
    url: baseURL,
    env: {
      CRITIQUE_WEB_PORT: port,
      VEASHI_FOREIGN_PORT: process.env.VEASHI_FOREIGN_PORT ?? "auto",
      VEASHI_HOME_PORT: process.env.VEASHI_HOME_PORT ?? "auto",
    },
    reuseExistingServer: false,
    timeout: 900_000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
  },
});
