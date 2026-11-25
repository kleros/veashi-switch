import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Config } from "wagmi";
import type { DevnetEnv, NetworkEnv, RouteData, SwitchData } from "../data";
import { TESTNET_BUILD } from "./build";
import { routeConfig, type RouteConfig } from "./route";
import { initialRouteId, routeInPath } from "./routing";

/** Everything the pages need: the network config, the wagmi config and each route's data seam (default route first). */
export interface AppSetup {
  network: NetworkEnv;
  config: Config;
  routes: RouteData[];
}

/**
 * What `useSetup()` gives a component: the setup, and the route it is about with that route's env and data. The route
 * is the one a `RouteScope` above names, else the one the URL names (a tracked request's), else, on the Request page
 * only, the one picked there. A page about no single route (the Track list, a court case looked up in every route) gets
 * the default route with `neutral` set, so nothing on it claims a route.
 */
export interface ScopedSetup extends AppSetup {
  route: RouteData;
  env: DevnetEnv;
  data: SwitchData;
  neutral: boolean; // several routes, and this page is about none of them
  selectedId: string; // the route picked on the Request page
  selectRoute(id: string): void;
}

const ROUTE_KEY = "veashi.route";

function readStoredRoute(): string | null {
  try {
    return window.localStorage.getItem(ROUTE_KEY);
  } catch {
    return null;
  }
}

function storeRoute(id: string) {
  try {
    window.localStorage.setItem(ROUTE_KEY, id);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

interface SetupState {
  setup: AppSetup;
  selectedId: string;
  select(id: string): void;
}

const SetupContext = createContext<SetupState | null>(null);
const ScopeContext = createContext<string | null>(null);

export const SetupProvider: React.FC<{ setup: AppSetup; children: React.ReactNode }> = ({ setup, children }) => {
  const [selectedId, setSelectedId] = useState(() =>
    initialRouteId(setup.routes, typeof window === "undefined" ? "" : window.location.search, readStoredRoute()),
  );
  const select = useCallback(
    (id: string) => {
      if (!setup.routes.some((r) => r.id === id)) return;
      setSelectedId(id);
      storeRoute(id);
    },
    [setup.routes],
  );
  const value = useMemo(() => ({ setup, selectedId, select }), [setup, selectedId, select]);
  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
};

/** Everything below reads and writes through route `id` (a tracked request's route, whatever the pick). */
export const RouteScope: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => (
  <ScopeContext.Provider value={id}>{children}</ScopeContext.Provider>
);

/** The id of the route a component is about (see ScopedSetup), or null for a page about none of several routes. */
function useActiveRouteId(state: SetupState | null): string | null {
  const scoped = useContext(ScopeContext);
  const { pathname } = useLocation();
  if (!state) return null;
  const routes = state.setup.routes;
  if (routes.length === 1) return routes[0].id;
  return scoped ?? routeInPath(pathname, routes) ?? (pathname === "/" ? state.selectedId : null);
}

function scopedOf(state: SetupState, id: string | null): ScopedSetup {
  const route = state.setup.routes.find((r) => r.id === id) ?? state.setup.routes[0];
  return {
    ...state.setup,
    route,
    env: route.env,
    data: route.data,
    neutral: id === null,
    selectedId: state.selectedId,
    selectRoute: state.select,
  };
}

export function useSetup(): ScopedSetup {
  const s = useContext(SetupContext);
  const id = useActiveRouteId(s);
  if (!s) throw new Error("useSetup outside SetupProvider");
  return scopedOf(s, id);
}

/** The setup, or null before the network is loaded (the top bar still renders on the error page). */
export function useSetupMaybe(): ScopedSetup | null {
  const s = useContext(SetupContext);
  const id = useActiveRouteId(s);
  return s ? scopedOf(s, id) : null;
}

export { TESTNET_BUILD };

export function useChainNames(): { foreign: string; home: string; testnet: boolean } {
  const s = useSetupMaybe();
  if (!s) return { foreign: "the foreign chain", home: "the home chain", testnet: TESTNET_BUILD };
  const c = s.data.chains();
  return { foreign: c.foreign.name, home: c.home.name, testnet: c.foreign.network === "testnet" };
}

/** The block explorer link of a chain's transactions, or null (the devnet, or outside the setup). */
export function useExplorer(chain: "foreign" | "home"): ((hash: `0x${string}`) => string) | null {
  const s = useSetupMaybe();
  return s ? s.data.chains()[chain].explorerTxUrl : null;
}

export function useRoute(): RouteConfig {
  return routeConfig(useSetup().data.chains());
}

/** The route the page is about, or null before the network is loaded or on a page about none of several routes. */
export function useRouteMaybe(): RouteConfig | null {
  const s = useSetupMaybe();
  return s && !s.neutral ? routeConfig(s.data.chains()) : null;
}
