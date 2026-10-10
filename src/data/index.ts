// Seed stubs so the `pages` lane compiles from day one. The `chain` lane owns this file and replaces every body;
// the exported names and signatures are frozen for the run (see features/veashi-switch-ui/prd.md, "The seam").
import type { Config } from "wagmi";
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
  throw new Error("not implemented: the chain lane provides loadDevnetEnv");
}

/** wagmi config for the two devnet chains: the injected connector, plus the test connector when env.testWallet. */
export function createWagmiConfig(env: DevnetEnv): Config {
  void env;
  throw new Error("not implemented: the chain lane provides createWagmiConfig");
}

/** The chain-backed SwitchData over viem clients for both devnet chains and the connected wallet. */
export function createSwitchData(env: DevnetEnv, config: Config): SwitchData {
  void env;
  void config;
  throw new Error("not implemented: the chain lane provides createSwitchData");
}
