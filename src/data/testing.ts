// Fixtures for the data module's unit tests (never imported by the app).
import type { DevnetEnv } from "./index";

export const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
export const sampleEnv = () => ({
  foreign: { chainId: 84530001, rpcUrl: "http://127.0.0.1:8645", name: "Base-like" },
  home: { chainId: 421610001, rpcUrl: "http://localhost:8646", name: "Arbitrum-like" },
  addresses: {
    foreign: { ForeignGateway: A(1), GatewayLightbulb: A(2), USDC: A(3), Yaho: A(4), Yaru: A(5) },
    home: { HomeGateway: A(6), KlerosCoreRuler: A(7), Yaho: A(8), Yaru: A(9) },
  },
  testWallet: true,
});

/** sampleEnv as the data layer receives it: with parseDevnetEnv's defaults for a devnet.json that omits them. */
export const sampleDevnetEnv = (): DevnetEnv => {
  const raw = sampleEnv();
  return {
    ...raw,
    kind: "devnet",
    foreign: { ...raw.foreign, explorerUrl: null, fromBlock: 0n },
    home: { ...raw.home, explorerUrl: null, fromBlock: 0n },
  };
};
