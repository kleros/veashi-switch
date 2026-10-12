import React from "react";
import { createRoot } from "react-dom/client";
import { App, type Boot } from "./App";
import type { AppSetup } from "./components/setup";
import { plainError } from "./components/errors";
import { createSwitchData, createWagmiConfig, loadDevnetEnv } from "./data";

async function devnetSetup(): Promise<AppSetup> {
  const env = await loadDevnetEnv();
  const config = createWagmiConfig(env);
  return { env, config, data: createSwitchData(env, config) };
}

async function boot(): Promise<Boot> {
  try {
    // `vite --mode fake` (development only) swaps in an in-memory SwitchData to work on the UI without a devnet.
    // import.meta.env.DEV is false in every build, so the fake never reaches dist/.
    if (import.meta.env.DEV && import.meta.env.MODE === "fake") {
      const { fakeSetup } = await import("./components/dev/fakeSetup");
      return { setup: fakeSetup() };
    }
    return { setup: await devnetSetup() };
  } catch (e) {
    return { error: plainError(e) };
  }
}

void boot().then((b) =>
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App boot={b} />
    </React.StrictMode>,
  ),
);
