import React, { createContext, useContext } from "react";
import type { Config } from "wagmi";
import type { DevnetEnv, SwitchData } from "../data";
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

export function useChainNames(): { foreign: string; home: string } {
  const s = useContext(SetupContext);
  if (!s) return { foreign: "the foreign chain", home: "the home chain" };
  const c = s.data.chains();
  return { foreign: c.foreign.name, home: c.home.name };
}

export function useRoute(): RouteConfig {
  return routeConfig(useSetup().data.chains());
}

/** The route, or null before the devnet is loaded (the top bar still renders on the error page). */
export function useRouteMaybe(): RouteConfig | null {
  const s = useContext(SetupContext);
  return s ? routeConfig(s.data.chains()) : null;
}
