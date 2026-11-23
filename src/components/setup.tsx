import React, { createContext, useContext } from "react";
import type { Config } from "wagmi";
import type { DevnetEnv, SwitchData } from "../data";
import { TESTNET_BUILD } from "./build";
import { routeConfig, type RouteConfig } from "./route";

/** Everything the pages need: the devnet env, the wagmi config and the data seam. */
export interface AppSetup {
  env: DevnetEnv;
  config: Config;
  data: SwitchData;
}

const SetupContext = createContext<AppSetup | null>(null);

export const SetupProvider: React.FC<{ setup: AppSetup; children: React.ReactNode }> = ({ setup, children }) => (
  <SetupContext.Provider value={setup}>{children}</SetupContext.Provider>
);

export function useSetup(): AppSetup {
  const s = useContext(SetupContext);
  if (!s) throw new Error("useSetup outside SetupProvider");
  return s;
}

export { TESTNET_BUILD };

export function useChainNames(): { foreign: string; home: string; testnet: boolean } {
  const s = useContext(SetupContext);
  if (!s) return { foreign: "the foreign chain", home: "the home chain", testnet: TESTNET_BUILD };
  const c = s.data.chains();
  return { foreign: c.foreign.name, home: c.home.name, testnet: c.foreign.network === "testnet" };
}

/** The block explorer link of a chain's transactions, or null (the devnet, or outside the setup). */
export function useExplorer(chain: "foreign" | "home"): ((hash: `0x${string}`) => string) | null {
  const s = useContext(SetupContext);
  return s ? s.data.chains()[chain].explorerTxUrl : null;
}

export function useRoute(): RouteConfig {
  return routeConfig(useSetup().data.chains());
}

/** The route, or null before the devnet is loaded (the top bar still renders on the error page). */
export function useRouteMaybe(): RouteConfig | null {
  const s = useContext(SetupContext);
  return s ? routeConfig(s.data.chains()) : null;
}
