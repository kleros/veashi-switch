// Parsing and safety checks for the network config: public/devnet.json (written by scripts/devnet.sh after
// deploying) or config/testnet.json (public testnets, bundled at build time).
import { isAddress, zeroAddress } from "viem";
import type { Address } from "./types";

export type NetworkKind = "devnet" | "testnet";

export interface DevnetChainEnv {
  chainId: number;
  rpcUrl: string;
  name: string; // shown in the UI, e.g. "Base Sepolia"
  explorerUrl: string | null; // block explorer base URL; null on the devnet
  fromBlock: bigint; // first block to scan for logs (the deployment block); 0n on the devnet
}

// Same shape as `DevnetEnv` in index.ts (re-declared here so env.ts has no import cycle).
export interface ParsedDevnetEnv {
  kind: NetworkKind;
  foreign: DevnetChainEnv;
  home: DevnetChainEnv;
  addresses: { foreign: Record<string, Address>; home: Record<string, Address> };
  testWallet: boolean; // always false on a testnet
}

/** Starts every NotConfiguredError message, so the boot screen can recognise it once it is only a string. */
export const NOT_CONFIGURED_PREFIX = "Not connected to contracts yet.";

/** Thrown when the testnet config still has placeholder addresses: the site is deployed but not wired up yet. */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

/** The only public chains a testnet config may point at; mainnets are refused on purpose. */
export const TESTNET_CHAINS: Readonly<Record<number, string>> = {
  84532: "Base Sepolia",
  421614: "Arbitrum Sepolia",
  11155111: "Sepolia",
};

/** Contracts the app cannot work without. */
export const REQUIRED_ADDRESSES = {
  foreign: ["ForeignGateway", "GatewayLightbulb", "USDC", "Yaho", "Yaru"],
  home: ["HomeGateway", "KlerosCoreRuler", "Yaho", "Yaru"],
} as const;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** The devnet only ever runs on this machine: anything else could be a public chain. */
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
  return { chainId, rpcUrl, name, explorerUrl: null, fromBlock: 0n };
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

function failTestnet(reason: string): never {
  throw new Error(`The testnet config is not usable: ${reason}. Check config/testnet.json.`);
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function parseFromBlock(value: unknown, key: string): bigint {
  if (value === undefined) return 0n;
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return failTestnet(`"${key}.fromBlock" must be a non-negative whole number`);
}

function parseTestnetChain(value: unknown, key: "foreign" | "home"): DevnetChainEnv {
  if (typeof value !== "object" || value === null) failTestnet(`"${key}" is missing`);
  const { chainId, rpcUrl, name, explorerUrl, fromBlock } = value as Record<string, unknown>;
  if (typeof chainId !== "number" || !(chainId in TESTNET_CHAINS)) {
    failTestnet(`"${key}.chainId" (${String(chainId)}) is not a supported public testnet`);
  }
  if (typeof rpcUrl !== "string" || !isHttpsUrl(rpcUrl)) failTestnet(`"${key}.rpcUrl" must be an https URL`);
  if (typeof explorerUrl !== "string" || !isHttpsUrl(explorerUrl)) failTestnet(`"${key}.explorerUrl" must be an https URL`);
  return {
    chainId,
    rpcUrl,
    name: typeof name === "string" && name !== "" ? name : (TESTNET_CHAINS[chainId] ?? String(chainId)),
    explorerUrl: explorerUrl.replace(/\/+$/, ""),
    fromBlock: parseFromBlock(fromBlock, key),
  };
}

/** Parses one chain's addresses; names of required contracts that are blank or zero go to `missing`. */
function parseTestnetAddresses(value: unknown, key: "foreign" | "home", missing: string[]): Record<string, Address> {
  if (typeof value !== "object" || value === null) failTestnet(`"addresses.${key}" is missing`);
  const raw = value as Record<string, unknown>;
  const out: Record<string, Address> = {};
  for (const [name, address] of Object.entries(raw)) {
    if (address === undefined || address === null || address === "") continue; // an unfilled placeholder
    if (typeof address !== "string" || !isAddress(address)) failTestnet(`"addresses.${key}.${name}" is not an address`);
    if (address.toLowerCase() !== zeroAddress) out[name] = address as Address;
  }
  for (const name of REQUIRED_ADDRESSES[key]) {
    if (!out[name]) missing.push(`${key}.${name}`);
  }
  return out;
}

function parseTestnetEnv(raw: Record<string, unknown>): ParsedDevnetEnv {
  const foreign = parseTestnetChain(raw.foreign, "foreign");
  const home = parseTestnetChain(raw.home, "home");
  if (foreign.chainId === home.chainId) failTestnet("both chains have the same chain id");
  const addresses = raw.addresses as Record<string, unknown> | undefined;
  if (typeof addresses !== "object" || addresses === null) failTestnet(`"addresses" is missing`);
  const missing: string[] = [];
  const parsed = {
    foreign: parseTestnetAddresses(addresses.foreign, "foreign", missing),
    home: parseTestnetAddresses(addresses.home, "home", missing),
  };
  if (missing.length > 0) {
    throw new NotConfiguredError(
      `${NOT_CONFIGURED_PREFIX} The contract addresses for ${foreign.name} and ${home.name} are not set yet ` +
        `(missing: ${missing.join(", ")}). They go in config/testnet.json.`,
    );
  }
  return { kind: "testnet", foreign, home, addresses: parsed, testWallet: false };
}

/** Validates a network config (devnet.json or testnet.json); throws a plain-language error otherwise. */
export function parseDevnetEnv(json: unknown): ParsedDevnetEnv {
  if (typeof json !== "object" || json === null) fail("it is not a JSON object");
  const raw = json as Record<string, unknown>;
  if (raw.kind === "testnet") return parseTestnetEnv(raw);
  if (raw.kind !== undefined && raw.kind !== "devnet") fail(`"kind" (${String(raw.kind)}) is not devnet or testnet`);
  const foreign = parseChain(raw.foreign, "foreign");
  const home = parseChain(raw.home, "home");
  if (foreign.chainId === home.chainId) fail("both chains have the same chain id");
  const addresses = raw.addresses as Record<string, unknown> | undefined;
  if (typeof addresses !== "object" || addresses === null) fail(`"addresses" is missing`);
  return {
    kind: "devnet",
    foreign,
    home,
    addresses: { foreign: parseAddresses(addresses.foreign, "foreign"), home: parseAddresses(addresses.home, "home") },
    testWallet: raw.testWallet === true,
  };
}

/** Link to a transaction in the chain's block explorer; null when the chain has none (the devnet). */
export function explorerTxUrl(chain: DevnetChainEnv, hash: string): string | null {
  return chain.explorerUrl ? `${chain.explorerUrl}/tx/${hash}` : null;
}
