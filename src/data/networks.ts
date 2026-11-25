// The viem chain objects for a network config: viem's own definitions on the public testnets (so multicall and
// ENS addresses stay right), a generated local chain on the devnet.
import { arbitrumSepolia, baseSepolia, sepolia } from "viem/chains";
import { defineChain, type Chain } from "viem";
import { ARC_TESTNET_ID, type DevnetChainEnv, type ParsedDevnetEnv } from "./env";

/**
 * Arc testnet (Circle's chain), which this viem version does not define. Its gas token is USDC, with 18 decimals at
 * the EVM and RPC level (its ERC-20 view at 0x3600…0000 uses 6 and is not what the app pays with). No multicall3 is
 * declared: the app reads contract by contract.
 */
export const arcTestnet = defineChain({
  id: ARC_TESTNET_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arc Testnet Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

const KNOWN_TESTNETS: Readonly<Record<number, Chain>> = {
  [baseSepolia.id]: baseSepolia,
  [arbitrumSepolia.id]: arbitrumSepolia,
  [sepolia.id]: sepolia,
  [arcTestnet.id]: arcTestnet,
};

/** The viem chain for one configured testnet chain: the known definition with the configured RPC. */
export function testnetChain(c: DevnetChainEnv): Chain {
  const known = KNOWN_TESTNETS[c.chainId];
  if (!known) throw new Error(`Chain ${c.chainId} is not a supported public testnet.`);
  return { ...known, rpcUrls: { ...known.rpcUrls, default: { ...known.rpcUrls.default, http: [c.rpcUrl] } } };
}

export function devnetChain(c: DevnetChainEnv): Chain {
  const native = c.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 };
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: native.name, symbol: native.symbol, decimals: native.decimals },
    rpcUrls: { default: { http: [c.rpcUrl] } },
    testnet: true,
  });
}

export function viemChains(env: Pick<ParsedDevnetEnv, "kind" | "foreign" | "home">): { foreign: Chain; home: Chain } {
  const make = env.kind === "testnet" ? testnetChain : devnetChain;
  return { foreign: make(env.foreign), home: make(env.home) };
}

/** Every chain of every route, once each, in route order (the wagmi config's chains). */
export function routeChains(routes: Pick<ParsedDevnetEnv, "kind" | "foreign" | "home">[]): Chain[] {
  const out: Chain[] = [];
  for (const route of routes) {
    const { foreign, home } = viemChains(route);
    for (const chain of [foreign, home]) if (!out.some((c) => c.id === chain.id)) out.push(chain);
  }
  return out;
}
