// The data module the pages read and write through (its types are in types.ts); the implementation lives in the
// sibling files.
import { createConfig, http, injected, mock, type Config, type CreateConnectorFn } from "wagmi";
import { createChainSwitchData, DEV_ACCOUNT } from "./chain";
import type { Chain } from "viem";
import {
  checkRoutes,
  parseDevnetEnv,
  parseNetworkEnv,
  REQUIRED_ADDRESSES,
  type NativeCurrency,
  type NetworkKind,
  type ParsedDevnetEnv,
} from "./env";
import { SwitchError } from "./errors";
import { routeChains } from "./networks";
import type { Address, SwitchData } from "./types";

export * from "./types";

interface ChainEnv {
  chainId: number;
  rpcUrl: string;
  name: string;
  explorerUrl: string | null;
  fromBlock: bigint;
  // parseDevnetEnv fills these in when a config omits them: the chain's gas token, and no known getLogs range.
  nativeCurrency?: NativeCurrency;
  logRange?: bigint | null;
}

/**
 * One route of the chain-backed config, as parsed by env.ts: public/devnet.json on the devnet, a route of
 * config/testnet.json on a testnet.
 */
export interface DevnetEnv {
  // parseDevnetEnv fills these in for a devnet.json without them: kind "devnet", id "default", explorerUrl null,
  // fromBlock 0n, the ETH gas token, jurorGuide ["GatewayLightbulbV2"].
  kind: NetworkKind;
  id?: string; // the route's slug ("base", "arc"); the default route's never shows in a URL
  foreign: ChainEnv;
  home: ChainEnv;
  addresses: {
    foreign: Record<string, Address>; // ForeignGateway, GatewayLightbulb, USDC, Yaho, Yaru, adapters...
    home: Record<string, Address>; // HomeGateway, KlerosCoreRuler, Yaho, Yaru, adapters...
  };
  testWallet: boolean; // true when the app may offer the dev-account test connector (devnet only)
  scannerUrl: string | null; // Veashi Scanner base URL, testnet only; null hides the scanner links
  jurorGuide?: string[]; // the lightbulb keys whose requests get Track's juror line
}

/** The whole config: every route, the default (first) one first. */
export interface NetworkEnv {
  kind: NetworkKind;
  routes: DevnetEnv[];
  testWallet: boolean;
  scannerUrl: string | null;
}

/** One route as the pages use it: its config, its own data seam, and the contracts it still lacks. */
export interface RouteData {
  id: string;
  isDefault: boolean; // the first route: its requests keep the bare /track/<id> URL
  env: DevnetEnv;
  data: SwitchData;
  missing: string[]; // required contracts the config leaves unset ("foreign.GatewayLightbulb"); non-empty: not set up
}

/** Fetches /devnet.json; rejects with a plain-language error when the devnet is not running. */
async function loadDevnetJson(): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch("/devnet.json", { cache: "no-store" });
  } catch {
    throw new Error("The local devnet is not running: start it with `yarn devnet`, then reload.");
  }
  if (!response.ok) {
    throw new Error("The local devnet is not running (no devnet.json): start it with `yarn devnet`, then reload.");
  }
  try {
    return await response.json();
  } catch {
    throw new Error("devnet.json is not valid JSON: restart the devnet with `yarn devnet`.");
  }
}

/** Replaces a chain's rpcUrl with an override from the build environment; env.ts still checks it is https. */
function withRpcOverride(chain: unknown, rpcUrl: string | undefined): unknown {
  if (!rpcUrl || typeof chain !== "object" || chain === null) return chain;
  // another RPC has its own getLogs limit: the configured one's no longer applies
  return { ...chain, rpcUrl, logRange: undefined };
}

type RawChain = { chainId?: unknown } & Record<string, unknown>;

/**
 * The build's RPC overrides on a testnet config: `VITE_VEASHI_RPC_<chainId>` replaces any chain's RPC, wherever a route
 * uses it; `VITE_VEASHI_FOREIGN_RPC` the default route's foreign chain, and `VITE_VEASHI_HOME_RPC` the default route's
 * home chain (in every route whose court is on it). All of them must still be https.
 */
export function applyRpcOverrides(json: Record<string, unknown>, vars: Record<string, string | undefined>): Record<string, unknown> {
  const byId = (chain: unknown) => {
    const id = (chain as RawChain | null)?.chainId;
    return typeof id === "number" ? vars[`VITE_VEASHI_RPC_${id}`] : undefined;
  };
  if (!Array.isArray(json.routes)) {
    return {
      ...json,
      foreign: withRpcOverride(json.foreign, byId(json.foreign) ?? vars.VITE_VEASHI_FOREIGN_RPC),
      home: withRpcOverride(json.home, byId(json.home) ?? vars.VITE_VEASHI_HOME_RPC),
    };
  }
  const routes = json.routes as Record<string, unknown>[];
  const homeId = (routes[0]?.home as RawChain | undefined)?.chainId;
  return {
    ...json,
    routes: routes.map((route, i) => {
      if (typeof route !== "object" || route === null) return route;
      const home = route.home as RawChain | undefined;
      const homeVar = home?.chainId === homeId ? vars.VITE_VEASHI_HOME_RPC : undefined;
      return {
        ...route,
        foreign: withRpcOverride(route.foreign, byId(route.foreign) ?? (i === 0 ? vars.VITE_VEASHI_FOREIGN_RPC : undefined)),
        home: withRpcOverride(route.home, byId(route.home) ?? homeVar),
      };
    }),
  };
}

/** The build's VITE_VEASHI_* variables (import.meta.env only has the ones the build was given). */
function buildVars(): Record<string, string | undefined> {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  return Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("VITE_VEASHI_")));
}

/** The testnet config bundled at build time (config/testnet.json), with optional RPC overrides from the build. */
async function loadTestnetJson(): Promise<unknown> {
  // Imported on demand so devnet builds do not carry it.
  const { default: json } = await import("../../config/testnet.json");
  return applyRpcOverrides(json as Record<string, unknown>, buildVars());
}

/** Loads the network config the build targets (VITE_VEASHI_NETWORK), every route; rejects in plain language when unusable. */
export async function loadNetwork(): Promise<NetworkEnv> {
  const json = import.meta.env.VITE_VEASHI_NETWORK === "testnet" ? await loadTestnetJson() : await loadDevnetJson();
  return parseNetworkEnv(json);
}

/** The default route of the network config the build targets (what the devnet scripts and single-route code use). */
export async function loadEnv(): Promise<DevnetEnv> {
  return (await loadNetwork()).routes[0];
}

/** Former name of loadEnv. */
export const loadDevnetEnv = loadEnv;

const isNetwork = (env: DevnetEnv | NetworkEnv): env is NetworkEnv => Array.isArray((env as NetworkEnv).routes);

/** Every route of a config, parsed again (a hand-built env gets env.ts's checks and defaults). */
function routesOf(env: DevnetEnv | NetworkEnv): ParsedDevnetEnv[] {
  const routes = isNetwork(env) ? env.routes.map((r) => parseDevnetEnv(r)) : [parseDevnetEnv(env)];
  if (routes.length > 1) checkRoutes(routes);
  return routes;
}

/**
 * wagmi config for every chain of every route (each once, so two routes with their court on Arbitrum Sepolia share
 * it): the injected connector, plus the test connector when env.testWallet.
 */
export function createWagmiConfig(env: DevnetEnv | NetworkEnv): Config {
  const routes = routesOf(env);
  const chains = routeChains(routes) as [Chain, ...Chain[]];
  const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
  // The anvil dev account, unlocked on the devnet: the mock connector forwards eth_sendTransaction to anvil.
  if (routes.some((r) => r.testWallet)) connectors.push(mock({ accounts: [DEV_ACCOUNT] }));
  const transports = Object.fromEntries(chains.map((c) => [c.id, http(c.rpcUrls.default.http[0])]));
  return createConfig({ chains, connectors, transports });
}

/** Required contracts the config leaves unset, as "foreign.GatewayLightbulb"; only a testnet config can have any. */
export function missingContracts(env: DevnetEnv): string[] {
  return (["foreign", "home"] as const).flatMap((key) =>
    REQUIRED_ADDRESSES[key].filter((name) => !env.addresses[key][name]).map((name) => `${key}.${name}`),
  );
}

/**
 * A testnet site whose contracts are not all set yet: the pages render, but every read and send rejects at once in
 * plain language, so no call goes out with an empty address (an event search would then cover every contract).
 */
function unconfiguredSwitchData(base: SwitchData, missing: string[]): SwitchData {
  const notSet = (): Promise<never> =>
    Promise.reject(
      new SwitchError(
        `The Veashi contracts are not set up on the test networks yet: ${missing.join(", ")} ` +
          `${missing.length === 1 ? "is" : "are"} not set in config/testnet.json.`,
      ),
    );
  return {
    chains: base.chains,
    payTokens: base.payTokens,
    validateSelection: base.validateSelection,
    oracles: notSet,
    defaultSelection: notSet,
    quote: notSet,
    bulbIsOn: notSet,
    balance: notSet,
    usdcAllowance: notSet,
    approveUsdc: notSet,
    requestSwitch: notSet,
    request: notSet,
    caseRequest: notSet,
    requests: notSet,
    watchRequest: () => () => {},
    act: notSet,
  };
}

/** The chain-backed SwitchData of one route, over viem clients for both its chains and the connected wallet. */
export function createSwitchData(env: DevnetEnv, config: Config): SwitchData {
  const parsed = parseDevnetEnv(env);
  const data = createChainSwitchData(parsed, config);
  const missing = missingContracts(parsed);
  return missing.length > 0 ? unconfiguredSwitchData(data, missing) : data;
}

/** Every route of the config with its own data seam, the default (first) route first. */
export function createRoutes(network: NetworkEnv, config: Config): RouteData[] {
  return routesOf(network).map((env, i) => ({
    id: env.id,
    isDefault: i === 0,
    env,
    data: createSwitchData(env, config),
    missing: missingContracts(env),
  }));
}
