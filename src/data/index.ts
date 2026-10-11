// The data module the pages read and write through. Exported names and signatures are frozen for the run
// (see features/veashi-switch-ui/prd.md, "The seam"); the implementation lives in the sibling files.
import { createConfig, http, injected, mock, type Config, type CreateConnectorFn } from "wagmi";
import { createChainSwitchData, DEV_ACCOUNT, devnetChains } from "./chain";
import { parseDevnetEnv } from "./env";
import type { Address, SwitchData } from "./types";

export * from "./types";

/** What scripts/devnet.sh writes to public/devnet.json after deploying, and the app fetches at startup. */
export interface DevnetEnv {
  foreign: { chainId: number; rpcUrl: string; name: string };
  home: { chainId: number; rpcUrl: string; name: string };
  addresses: {
    foreign: Record<string, Address>; // ForeignGateway, GatewayLightbulb, USDC, Yaho, Yaru, adapters...
    home: Record<string, Address>; // HomeGateway, KlerosCoreRuler, Yaho, Yaru, adapters...
  };
  testWallet: boolean; // true when the app may offer the dev-account test connector (devnet only)
}

/** Fetches /devnet.json; rejects with a plain-language error when the devnet is not running. */
export async function loadDevnetEnv(): Promise<DevnetEnv> {
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

/** wagmi config for the two devnet chains: the injected connector, plus the test connector when env.testWallet. */
export function createWagmiConfig(env: DevnetEnv): Config {
  const chains = devnetChains(parseDevnetEnv(env));
  const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
  // The anvil dev account, unlocked on the devnet: the mock connector forwards eth_sendTransaction to anvil.
  if (env.testWallet) connectors.push(mock({ accounts: [DEV_ACCOUNT] }));
  return createConfig({
    chains: [chains.foreign, chains.home],
    connectors,
    transports: {
      [chains.foreign.id]: http(env.foreign.rpcUrl),
      [chains.home.id]: http(env.home.rpcUrl),
    },
  });
}

/** The chain-backed SwitchData over viem clients for both devnet chains and the connected wallet. */
export function createSwitchData(env: DevnetEnv, config: Config): SwitchData {
  return createChainSwitchData(parseDevnetEnv(env), config);
}
