// The data module the pages read and write through (its types are in types.ts); the implementation lives in the
// sibling files.
import { createConfig, http, injected, mock, type Config, type CreateConnectorFn } from "wagmi";
import { createChainSwitchData, DEV_ACCOUNT } from "./chain";
import { parseDevnetEnv, type NetworkKind } from "./env";
import { viemChains } from "./networks";
import type { Address, SwitchData } from "./types";

export * from "./types";

/** The chain-backed config, as parsed by env.ts: public/devnet.json on the devnet, config/testnet.json on a testnet. */
export interface DevnetEnv {
  // Optional so that older literals (the fake setup, test fixtures) still type-check; parseDevnetEnv always fills
  // them in: kind "devnet", explorerUrl null and fromBlock 0n when absent.
  kind?: NetworkKind;
  foreign: { chainId: number; rpcUrl: string; name: string; explorerUrl?: string | null; fromBlock?: bigint };
  home: { chainId: number; rpcUrl: string; name: string; explorerUrl?: string | null; fromBlock?: bigint };
  addresses: {
    foreign: Record<string, Address>; // ForeignGateway, GatewayLightbulb, USDC, Yaho, Yaru, adapters...
    home: Record<string, Address>; // HomeGateway, KlerosCoreRuler, Yaho, Yaru, adapters...
  };
  testWallet: boolean; // true when the app may offer the dev-account test connector (devnet only)
}

/** Fetches /devnet.json; rejects with a plain-language error when the devnet is not running. */
async function loadDevnetJson(): Promise<DevnetEnv> {
  let response: Response;
  try {
    response = await fetch("/devnet.json", { cache: "no-store" });
  } catch {
    throw new Error("The local devnet is not running: start it with `yarn devnet`, then reload.");
  }
  if (!response.ok) {
    throw new Error("The local devnet is not running (no devnet.json): start it with `yarn devnet`, then reload.");
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error("devnet.json is not valid JSON: restart the devnet with `yarn devnet`.");
  }
  return parseDevnetEnv(json);
}

/** Replaces a chain's rpcUrl with an override from the build environment; env.ts still checks it is https. */
function withRpcOverride(chain: unknown, rpcUrl: string | undefined): unknown {
  if (!rpcUrl || typeof chain !== "object" || chain === null) return chain;
  return { ...chain, rpcUrl };
}

/** The testnet config bundled at build time (config/testnet.json), with optional RPC overrides from the build. */
async function loadTestnetJson(): Promise<DevnetEnv> {
  // Imported on demand so devnet builds do not carry it.
  const { default: json } = await import("../../config/testnet.json");
  return parseDevnetEnv({
    ...json,
    foreign: withRpcOverride(json.foreign, import.meta.env.VITE_VEASHI_FOREIGN_RPC),
    home: withRpcOverride(json.home, import.meta.env.VITE_VEASHI_HOME_RPC),
  });
}

/** Loads the network config the build targets (VITE_VEASHI_NETWORK); rejects in plain language when unusable. */
export function loadEnv(): Promise<DevnetEnv> {
  return import.meta.env.VITE_VEASHI_NETWORK === "testnet" ? loadTestnetJson() : loadDevnetJson();
}

/** Former name of loadEnv. */
export const loadDevnetEnv = loadEnv;

/** wagmi config for the two chains: the injected connector, plus the test connector when env.testWallet. */
export function createWagmiConfig(env: DevnetEnv): Config {
  const parsed = parseDevnetEnv(env);
  const chains = viemChains(parsed);
  const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
  // The anvil dev account, unlocked on the devnet: the mock connector forwards eth_sendTransaction to anvil.
  if (parsed.testWallet) connectors.push(mock({ accounts: [DEV_ACCOUNT] }));
  return createConfig({
    chains: [chains.foreign, chains.home],
    connectors,
    transports: {
      [chains.foreign.id]: http(parsed.foreign.rpcUrl),
      [chains.home.id]: http(parsed.home.rpcUrl),
    },
  });
}

/** The chain-backed SwitchData over viem clients for both devnet chains and the connected wallet. */
export function createSwitchData(env: DevnetEnv, config: Config): SwitchData {
  return createChainSwitchData(parseDevnetEnv(env), config);
}
