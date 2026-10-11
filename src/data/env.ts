// Parsing and safety checks for public/devnet.json, the file scripts/devnet.sh writes after deploying.
import { isAddress } from "viem";
import type { Address } from "./types";

export interface DevnetChainEnv {
  chainId: number;
  rpcUrl: string;
  name: string;
}

// Same shape as `DevnetEnv` in index.ts (re-declared here so env.ts has no import cycle).
export interface ParsedDevnetEnv {
  foreign: DevnetChainEnv;
  home: DevnetChainEnv;
  addresses: { foreign: Record<string, Address>; home: Record<string, Address> };
  testWallet: boolean;
}

/** Contracts the app cannot work without. */
export const REQUIRED_ADDRESSES = {
  foreign: ["ForeignGateway", "GatewayLightbulb", "USDC", "Yaho", "Yaru"],
  home: ["HomeGateway", "KlerosCoreRuler", "Yaho", "Yaru"],
} as const;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** The devnet only ever runs on this machine: anything else could be a public chain ([O1]). */
export function isLocalRpcUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (parsed.protocol === "http:" || parsed.protocol === "ws:") && LOCAL_HOSTS.has(parsed.hostname);
}

function fail(reason: string): never {
  throw new Error(`devnet.json is not usable: ${reason}. Restart the devnet with \`yarn devnet\`.`);
}

function parseChain(value: unknown, key: "foreign" | "home"): DevnetChainEnv {
  if (typeof value !== "object" || value === null) fail(`"${key}" is missing`);
  const { chainId, rpcUrl, name } = value as Record<string, unknown>;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) fail(`"${key}.chainId" is invalid`);
  if (typeof rpcUrl !== "string") fail(`"${key}.rpcUrl" is missing`);
  if (!isLocalRpcUrl(rpcUrl)) {
    fail(`"${key}.rpcUrl" (${rpcUrl}) is not a local URL; only 127.0.0.1 or localhost are allowed`);
  }
  if (typeof name !== "string" || name === "") fail(`"${key}.name" is missing`);
  return { chainId, rpcUrl, name };
}

function parseAddresses(value: unknown, key: "foreign" | "home"): Record<string, Address> {
  if (typeof value !== "object" || value === null) fail(`"addresses.${key}" is missing`);
  const out: Record<string, Address> = {};
  for (const [name, address] of Object.entries(value as Record<string, unknown>)) {
    if (typeof address !== "string" || !isAddress(address)) fail(`"addresses.${key}.${name}" is not an address`);
    out[name] = address as Address;
  }
  for (const name of REQUIRED_ADDRESSES[key]) {
    if (!out[name]) fail(`"addresses.${key}.${name}" is missing`);
  }
  return out;
}

/** Validates the JSON written by scripts/devnet.sh; throws a plain-language error otherwise. */
export function parseDevnetEnv(json: unknown): ParsedDevnetEnv {
  if (typeof json !== "object" || json === null) fail("it is not a JSON object");
  const raw = json as Record<string, unknown>;
  const foreign = parseChain(raw.foreign, "foreign");
  const home = parseChain(raw.home, "home");
  if (foreign.chainId === home.chainId) fail("both chains have the same chain id");
  const addresses = raw.addresses as Record<string, unknown> | undefined;
  if (typeof addresses !== "object" || addresses === null) fail(`"addresses" is missing`);
  return {
    foreign,
    home,
    addresses: { foreign: parseAddresses(addresses.foreign, "foreign"), home: parseAddresses(addresses.home, "home") },
    testWallet: raw.testWallet === true,
  };
}
