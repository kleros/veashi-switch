// The viem chain objects for a network config: viem's own definitions on the public testnets (so multicall and
// ENS addresses stay right), a generated local chain on the devnet.
import { arbitrumSepolia, baseSepolia, sepolia } from "viem/chains";
import { defineChain, type Chain } from "viem";
import type { DevnetChainEnv, ParsedDevnetEnv } from "./env";

const KNOWN_TESTNETS: Readonly<Record<number, Chain>> = {
  [baseSepolia.id]: baseSepolia,
  [arbitrumSepolia.id]: arbitrumSepolia,
  [sepolia.id]: sepolia,
};

function testnetChain(c: DevnetChainEnv): Chain {
  const known = KNOWN_TESTNETS[c.chainId];
  if (!known) throw new Error(`Chain ${c.chainId} is not a supported public testnet.`);
  return { ...known, rpcUrls: { ...known.rpcUrls, default: { ...known.rpcUrls.default, http: [c.rpcUrl] } } };
}

function devnetChain(c: DevnetChainEnv): Chain {
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
    testnet: true,
  });
}

export function viemChains(env: ParsedDevnetEnv): { foreign: Chain; home: Chain } {
  const make = env.kind === "testnet" ? testnetChain : devnetChain;
  return { foreign: make(env.foreign), home: make(env.home) };
}
