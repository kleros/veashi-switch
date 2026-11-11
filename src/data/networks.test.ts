import { describe, expect, it } from "vitest";
import { parseDevnetEnv } from "./env";
import { viemChains } from "./networks";
import { sampleEnv } from "./testing";

const testnetJson = () => ({
  kind: "testnet",
  foreign: { chainId: 84532, name: "Base Sepolia", rpcUrl: "https://rpc.example/base", explorerUrl: "https://sepolia.basescan.org" },
  home: { chainId: 421614, name: "Arbitrum Sepolia", rpcUrl: "https://rpc.example/arb", explorerUrl: "https://sepolia.arbiscan.io" },
  addresses: sampleEnv().addresses,
});

describe("viemChains", () => {
  it("uses viem's built-in testnet chains with the configured RPC", () => {
    const { foreign, home } = viemChains(parseDevnetEnv(testnetJson()));
    expect(foreign.id).toBe(84532);
    expect(foreign.rpcUrls.default.http).toEqual(["https://rpc.example/base"]);
    expect(foreign.contracts?.multicall3).toBeDefined(); // comes from viem's definition
    expect(home.id).toBe(421614);
    expect(home.rpcUrls.default.http).toEqual(["https://rpc.example/arb"]);
    expect(home.testnet).toBe(true);
  });
  it("builds local chains on the devnet", () => {
    const { foreign, home } = viemChains(parseDevnetEnv(sampleEnv()));
    expect(foreign).toMatchObject({ id: 84530001, name: "Base-like", testnet: true });
    expect(foreign.rpcUrls.default.http).toEqual(["http://127.0.0.1:8645"]);
    expect(foreign.contracts).toBeUndefined();
    expect(home.id).toBe(421610001);
  });
});
