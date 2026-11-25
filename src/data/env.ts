// Parsing and safety checks for the network config: public/devnet.json (written by scripts/devnet.sh after
// deploying) or config/testnet.json (public testnets, bundled at build time).
//
// A config holds one or more routes. A route is one foreign chain (where the requester's bulb lives) with its own
// ForeignGateway and lightbulb(s), and one home chain (the court) with its own HomeGateway. devnet.json is always a
// single route. config/testnet.json lists its routes under `routes`; the first is the default route, whose requests
// keep the bare /track/<id> URL. A config with `foreign`, `home` and `addresses` at the top is one route, as before.
import { isAddress, zeroAddress } from "viem";
import type { Address } from "./types";

export type NetworkKind = "devnet" | "testnet";

/** A chain's gas token: ETH on Base Sepolia and Arbitrum Sepolia, USDC on Arc testnet (18 decimals there too). */
export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface DevnetChainEnv {
  chainId: number;
  rpcUrl: string;
  name: string; // shown in the UI, e.g. "Base Sepolia"
  explorerUrl: string | null; // block explorer base URL; null on the devnet
  fromBlock: bigint; // first block to scan for logs (the deployment block); 0n on the devnet
  nativeCurrency: NativeCurrency;
  // The widest eth_getLogs block range the configured RPC allows, when known (Arc's public RPC: 10,000). Event scans
  // start with chunks of it instead of learning it from refusals. Null when unknown, or once the RPC URL is overridden.
  logRange: bigint | null;
}

/** One route, as the data layer works on it. Same shape as `DevnetEnv` in index.ts (re-declared here so env.ts has no import cycle). */
export interface ParsedDevnetEnv {
  kind: NetworkKind;
  id: string; // the route's slug in config and URLs, e.g. "base" or "arc"
  foreign: DevnetChainEnv;
  home: DevnetChainEnv;
  addresses: { foreign: Record<string, Address>; home: Record<string, Address> };
  testWallet: boolean; // always false on a testnet
  scannerUrl: string | null; // Veashi Scanner base URL (cross-chain message explorer); testnet only, null when unset
  // The `addresses.foreign` keys of the lightbulbs whose court template has the answers Track's juror line names
  // ("Switch it on" / "Switch it off"). Default: GatewayLightbulbV2 only.
  jurorGuide: string[];
  // No relay service carries this route's messages on to the contracts (the Hashi delivery, the case creation, the
  // ruling's dispatch): someone runs each step, so Track promises no automatic relay. Default false.
  manualRelay: boolean;
}

/** The whole config: its routes, the default (first) one first. */
export interface ParsedNetworkEnv {
  kind: NetworkKind;
  routes: ParsedDevnetEnv[];
  testWallet: boolean;
  scannerUrl: string | null;
}

/** Arc testnet's chain id (Circle's L1; its gas token is USDC). */
export const ARC_TESTNET_ID = 5_042_002;

/** The only public chains a testnet config may point at; mainnets are refused on purpose. */
export const TESTNET_CHAINS: Readonly<Record<number, string>> = {
  84532: "Base Sepolia",
  421614: "Arbitrum Sepolia",
  11155111: "Sepolia",
  [ARC_TESTNET_ID]: "Arc Testnet",
};

const ETHER: NativeCurrency = { name: "Ether", symbol: "ETH", decimals: 18 };

/** Each public testnet's gas token, which a config may restate but not change. */
export const TESTNET_NATIVE: Readonly<Record<number, NativeCurrency>> = {
  84532: ETHER,
  421614: ETHER,
  11155111: ETHER,
  [ARC_TESTNET_ID]: { name: "USDC", symbol: "USDC", decimals: 18 },
};

/**
 * Contracts a route cannot work without (enforced for devnet.json; a testnet route may leave them blank, and its reads
 * then fail at once naming them). USDC is optional on a testnet: a route without it is paid in the foreign chain's gas
 * token only (on Arc testnet that already is USDC).
 */
export const REQUIRED_ADDRESSES = {
  foreign: ["ForeignGateway", "GatewayLightbulb", "Yaho", "Yaru"],
  home: ["HomeGateway", "KlerosCoreRuler", "Yaho", "Yaru"],
} as const;

/** The devnet always deploys its USDC mock, so devnet.json must name it. */
const DEVNET_REQUIRED: Record<"foreign" | "home", readonly string[]> = {
  foreign: [...REQUIRED_ADDRESSES.foreign, "USDC"],
  home: REQUIRED_ADDRESSES.home,
};

/** The id of a single-route config that names none (devnet.json). It is the default route, so it never shows in a URL. */
export const SINGLE_ROUTE_ID = "default";

/** Route ids: lowercase, starting with a letter, so a route id never reads as a request number in /track/<id>. */
const ROUTE_ID = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The second lightbulb's key in `addresses.foreign`, optional. Blank or absent: new requests go to `GatewayLightbulb`.
 * Set: new requests go to it, and `GatewayLightbulb` stays readable, so its requests and court cases keep their links.
 * Both lightbulbs use the same ForeignGateway, whose dispute IDs (the request numbers) never repeat across them.
 * It is the lightbulb of the court template in docs/court-template.json: by default Track shows jurors the answer that
 * flips the bulb for its requests only (a route's `jurorGuide` can name others).
 */
export const LIGHTBULB_V2 = "GatewayLightbulbV2";

/** The lightbulb new requests go to: `GatewayLightbulbV2` once it is set, else `GatewayLightbulb`. */
export function activeLightbulb(foreign: Record<string, Address>): Address | undefined {
  return foreign[LIGHTBULB_V2] ?? foreign.GatewayLightbulb;
}

/** Every lightbulb whose requests the site reads: `GatewayLightbulb`, then `GatewayLightbulbV2` when it is set. */
export function knownLightbulbs(foreign: Record<string, Address>): Address[] {
  const out: Address[] = [];
  for (const address of [foreign.GatewayLightbulb, foreign[LIGHTBULB_V2]]) {
    if (address && !out.some((a) => a.toLowerCase() === address.toLowerCase())) out.push(address);
  }
  return out;
}

/**
 * True for a lightbulb whose court template Track's juror line follows: one named by the route's `jurorGuide` keys
 * (by default `GatewayLightbulbV2` only).
 */
export function isJurorGuidedLightbulb(
  foreign: Record<string, Address>,
  lightbulb: string,
  keys: readonly string[] = [LIGHTBULB_V2],
): boolean {
  return keys.some((key) => {
    const address = foreign[key];
    return !!address && address.toLowerCase() === lightbulb.toLowerCase();
  });
}

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

type Fail = (reason: string) => never;

/**
 * A chain's gas token. Absent means `fallback`. On a public testnet it must match the chain's own (so the fee text
 * never says ETH where the wallet pays USDC).
 */
function parseNativeCurrency(value: unknown, key: string, fallback: NativeCurrency, failWith: Fail, known?: NativeCurrency): NativeCurrency {
  if (value === undefined || value === null) return { ...fallback };
  if (typeof value !== "object") failWith(`"${key}.nativeCurrency" must be an object with symbol and decimals`);
  const { name, symbol, decimals } = value as Record<string, unknown>;
  if (typeof symbol !== "string" || !/^[A-Za-z0-9.]{1,11}$/.test(symbol)) failWith(`"${key}.nativeCurrency.symbol" is invalid`);
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    failWith(`"${key}.nativeCurrency.decimals" must be a whole number from 0 to 36`);
  }
  if (name !== undefined && (typeof name !== "string" || name === "")) failWith(`"${key}.nativeCurrency.name" is invalid`);
  if (known && (known.symbol !== symbol || known.decimals !== decimals)) {
    failWith(
      `"${key}.nativeCurrency" (${symbol}, ${decimals} decimals) is not the chain's gas token (${known.symbol}, ${known.decimals} decimals)`,
    );
  }
  return { name: typeof name === "string" ? name : (known?.name ?? (symbol === "ETH" ? "Ether" : symbol)), symbol, decimals };
}

function parseLogRange(value: unknown, key: string, failWith: Fail): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint" && value > 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  return failWith(`"${key}.logRange" must be a positive whole number of blocks`);
}

function parseRouteId(value: unknown, key: string, failWith: Fail): string {
  if (value === undefined) return SINGLE_ROUTE_ID;
  if (typeof value !== "string" || !ROUTE_ID.test(value)) {
    failWith(`"${key}" must be a short lowercase slug (a letter, then letters, digits or "-")`);
  }
  return value;
}

function parseJurorGuide(value: unknown, key: string, failWith: Fail): string[] {
  if (value === undefined || value === null) return [LIGHTBULB_V2];
  if (!Array.isArray(value) || !value.every((k) => typeof k === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(k))) {
    failWith(`"${key}" must be a list of lightbulb address keys, such as ["GatewayLightbulbV2"]`);
  }
  return [...new Set(value as string[])];
}

function parseManualRelay(value: unknown, key: string, failWith: Fail): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") failWith(`"${key}" must be true or false`);
  return value as boolean;
}

function parseChain(value: unknown, key: "foreign" | "home"): DevnetChainEnv {
  if (typeof value !== "object" || value === null) fail(`"${key}" is missing`);
  const { chainId, rpcUrl, name, nativeCurrency } = value as Record<string, unknown>;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) fail(`"${key}.chainId" is invalid`);
  if (typeof rpcUrl !== "string") fail(`"${key}.rpcUrl" is missing`);
  if (!isLocalRpcUrl(rpcUrl)) {
    fail(`"${key}.rpcUrl" (${rpcUrl}) is not a local URL; only 127.0.0.1 or localhost are allowed`);
  }
  if (typeof name !== "string" || name === "") fail(`"${key}.name" is missing`);
  return {
    chainId,
    rpcUrl,
    name,
    explorerUrl: null,
    fromBlock: 0n,
    nativeCurrency: parseNativeCurrency(nativeCurrency, key, ETHER, fail),
    logRange: null,
  };
}

function parseAddresses(value: unknown, key: "foreign" | "home"): Record<string, Address> {
  if (typeof value !== "object" || value === null) fail(`"addresses.${key}" is missing`);
  const out: Record<string, Address> = {};
  for (const [name, address] of Object.entries(value as Record<string, unknown>)) {
    if (typeof address !== "string" || !isAddress(address)) fail(`"addresses.${key}.${name}" is not an address`);
    out[name] = address as Address;
  }
  for (const name of DEVNET_REQUIRED[key]) {
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

/** An optional Veashi Scanner base URL: absent, null or blank means no scanner links. */
function parseScannerUrl(value: unknown, key = "scannerUrl"): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !isHttpsUrl(value)) failTestnet(`"${key}" must be an https URL`);
  // a bare "?" or "#" leaves URL.search and URL.hash empty, so the raw text is checked; the parsed URL is what is kept
  if (/[?#]/.test(value)) failTestnet(`"${key}" must not have a query or a fragment`);
  const url = new URL(value);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function parseTestnetChain(value: unknown, key: string): DevnetChainEnv {
  if (typeof value !== "object" || value === null) failTestnet(`"${key}" is missing`);
  const { chainId, rpcUrl, name, explorerUrl, fromBlock, nativeCurrency, logRange } = value as Record<string, unknown>;
  if (typeof chainId !== "number" || !(chainId in TESTNET_CHAINS)) {
    failTestnet(`"${key}.chainId" (${String(chainId)}) is not a supported public testnet`);
  }
  if (typeof rpcUrl !== "string" || !isHttpsUrl(rpcUrl)) failTestnet(`"${key}.rpcUrl" must be an https URL`);
  if (typeof explorerUrl !== "string" || !isHttpsUrl(explorerUrl)) failTestnet(`"${key}.explorerUrl" must be an https URL`);
  const known = TESTNET_NATIVE[chainId];
  return {
    chainId,
    rpcUrl,
    name: typeof name === "string" && name !== "" ? name : (TESTNET_CHAINS[chainId] ?? String(chainId)),
    explorerUrl: explorerUrl.replace(/\/+$/, ""),
    fromBlock: parseFromBlock(fromBlock, key),
    nativeCurrency: parseNativeCurrency(nativeCurrency, key, known, failTestnet, known),
    logRange: parseLogRange(logRange, key, failTestnet),
  };
}

/** Parses one chain's addresses; blank or zero entries (not deployed yet) are left out. */
function parseTestnetAddresses(value: unknown, key: string): Record<string, Address> {
  if (typeof value !== "object" || value === null) failTestnet(`"${key}" is missing`);
  const raw = value as Record<string, unknown>;
  const out: Record<string, Address> = {};
  for (const [name, address] of Object.entries(raw)) {
    if (address === undefined || address === null || address === "") continue; // an unfilled placeholder
    if (typeof address !== "string" || !isAddress(address)) failTestnet(`"${key}.${name}" is not an address`);
    if (address.toLowerCase() !== zeroAddress) out[name] = address as Address;
  }
  return out;
}

interface RouteLabels {
  at: string; // "" for a config with one route at the top, "routes[1]." in a list
  foreignAddresses: string;
  homeAddresses: string;
}

/** One testnet route. A route-level `scannerUrl` (blank: none) replaces the config's for that route. */
function parseTestnetRoute(
  raw: {
    id?: unknown;
    scannerUrl?: unknown;
    jurorGuide?: unknown;
    manualRelay?: unknown;
    foreign: unknown;
    home: unknown;
    addresses: { foreign: unknown; home: unknown };
  },
  scannerUrl: string | null,
  labels: RouteLabels,
): ParsedDevnetEnv {
  const { at } = labels;
  const id = parseRouteId(raw.id, `${at}id`, failTestnet);
  const foreign = parseTestnetChain(raw.foreign, `${at}foreign`);
  const home = parseTestnetChain(raw.home, `${at}home`);
  if (foreign.chainId === home.chainId) failTestnet(`${at ? `"${at}foreign" and "${at}home"` : "both chains"} have the same chain id`);
  // Blank addresses are not a boot error: the site still renders, and each read of an unset contract fails where
  // it is used, so the pages can be looked at before the contracts are deployed.
  const addresses = {
    foreign: parseTestnetAddresses(raw.addresses.foreign, labels.foreignAddresses),
    home: parseTestnetAddresses(raw.addresses.home, labels.homeAddresses),
  };
  return {
    kind: "testnet",
    id,
    foreign,
    home,
    addresses,
    testWallet: false,
    scannerUrl: raw.scannerUrl === undefined ? scannerUrl : parseScannerUrl(raw.scannerUrl, `${at}scannerUrl`),
    jurorGuide: parseJurorGuide(raw.jurorGuide, `${at}jurorGuide`, failTestnet),
    manualRelay: parseManualRelay(raw.manualRelay, `${at}manualRelay`, failTestnet),
  };
}

/** A single-route testnet config (foreign, home and addresses at the top), or one route as the data layer holds it. */
function parseTestnetEnv(raw: Record<string, unknown>): ParsedDevnetEnv {
  const addresses = raw.addresses as Record<string, unknown> | undefined;
  if (typeof addresses !== "object" || addresses === null) failTestnet(`"addresses" is missing`);
  return parseTestnetRoute(
    { id: raw.id, jurorGuide: raw.jurorGuide, manualRelay: raw.manualRelay, foreign: raw.foreign, home: raw.home, addresses: { foreign: addresses.foreign, home: addresses.home } },
    parseScannerUrl(raw.scannerUrl),
    { at: "", foreignAddresses: "addresses.foreign", homeAddresses: "addresses.home" },
  );
}

const SHARED_CHAIN_FIELDS = ["rpcUrl", "name", "explorerUrl"] as const;

/**
 * One chain, one setup: when two routes use the same chain (both routes' court is on Arbitrum Sepolia), its RPC, name,
 * explorer and gas token must agree, since the wallet and the UI know the chain once. fromBlock and the addresses are
 * per route. Route ids must differ.
 */
export function checkRoutes(routes: ParsedDevnetEnv[], failWith: Fail = failTestnet): void {
  const seen = new Map<number, { chain: DevnetChainEnv; where: string }>();
  routes.forEach((route, i) => {
    for (const side of ["foreign", "home"] as const) {
      const chain = route[side];
      const where = `routes[${i}].${side}`;
      const first = seen.get(chain.chainId);
      if (!first) {
        seen.set(chain.chainId, { chain, where });
        continue;
      }
      const differs = SHARED_CHAIN_FIELDS.find((f) => first.chain[f] !== chain[f]);
      const currency =
        first.chain.nativeCurrency.symbol !== chain.nativeCurrency.symbol ||
        first.chain.nativeCurrency.decimals !== chain.nativeCurrency.decimals;
      if (differs || currency) {
        failWith(`"${where}" sets up chain ${chain.chainId} differently from "${first.where}" (${differs ?? "nativeCurrency"}); one chain needs one setup`);
      }
    }
  });
  const ids = new Set<string>();
  for (const [i, route] of routes.entries()) {
    if (ids.has(route.id)) failWith(`"routes[${i}].id" (${route.id}) is used by another route`);
    ids.add(route.id);
  }
}

/** The routes of a testnet config: `routes` is a list of `{ id, foreign: {..., addresses}, home: {..., addresses} }`. */
function parseTestnetRoutes(raw: Record<string, unknown>): ParsedNetworkEnv {
  const scannerUrl = parseScannerUrl(raw.scannerUrl);
  if (!Array.isArray(raw.routes) || raw.routes.length === 0) failTestnet(`"routes" must be a list of at least one route`);
  for (const key of ["foreign", "home", "addresses"]) {
    if (raw[key] !== undefined) failTestnet(`"${key}" belongs inside each route when "routes" is set`);
  }
  const routes = raw.routes.map((value: unknown, i: number) => {
    const at = `routes[${i}].`;
    if (typeof value !== "object" || value === null) failTestnet(`"routes[${i}]" is not a route`);
    const r = value as Record<string, unknown>;
    if (r.id === undefined) failTestnet(`"${at}id" is missing`);
    const chainBlock = (side: "foreign" | "home") => {
      const block = r[side];
      if (typeof block !== "object" || block === null) failTestnet(`"${at}${side}" is missing`);
      const { addresses, ...chain } = block as Record<string, unknown>;
      return { chain, addresses };
    };
    const foreign = chainBlock("foreign");
    const home = chainBlock("home");
    return parseTestnetRoute(
      {
        id: r.id,
        scannerUrl: r.scannerUrl,
        jurorGuide: r.jurorGuide,
        manualRelay: r.manualRelay,
        foreign: foreign.chain,
        home: home.chain,
        addresses: { foreign: foreign.addresses, home: home.addresses },
      },
      scannerUrl,
      { at, foreignAddresses: `${at}foreign.addresses`, homeAddresses: `${at}home.addresses` },
    );
  });
  checkRoutes(routes);
  return { kind: "testnet", routes, testWallet: false, scannerUrl };
}

/**
 * Validates one route (devnet.json, a single-route testnet config, or a route as the data layer holds it); throws a
 * plain-language error otherwise. Given a config with `routes`, it returns the default (first) route.
 */
export function parseDevnetEnv(json: unknown): ParsedDevnetEnv {
  if (typeof json !== "object" || json === null) fail("it is not a JSON object");
  const raw = json as Record<string, unknown>;
  if (raw.routes !== undefined) return parseNetworkEnv(raw).routes[0];
  if (raw.kind === "testnet") return parseTestnetEnv(raw);
  if (raw.kind !== undefined && raw.kind !== "devnet") fail(`"kind" (${String(raw.kind)}) is not devnet or testnet`);
  const id = parseRouteId(raw.id, "id", fail);
  const foreign = parseChain(raw.foreign, "foreign");
  const home = parseChain(raw.home, "home");
  if (foreign.chainId === home.chainId) fail("both chains have the same chain id");
  const addresses = raw.addresses as Record<string, unknown> | undefined;
  if (typeof addresses !== "object" || addresses === null) fail(`"addresses" is missing`);
  return {
    kind: "devnet",
    id,
    foreign,
    home,
    addresses: { foreign: parseAddresses(addresses.foreign, "foreign"), home: parseAddresses(addresses.home, "home") },
    testWallet: raw.testWallet === true,
    scannerUrl: null, // local chains: the scanner cannot see them
    jurorGuide: parseJurorGuide(raw.jurorGuide, "jurorGuide", fail),
    manualRelay: parseManualRelay(raw.manualRelay, "manualRelay", fail),
  };
}

/** Validates a network config: devnet.json (one route), or config/testnet.json with its `routes` (or a single route). */
export function parseNetworkEnv(json: unknown): ParsedNetworkEnv {
  if (typeof json !== "object" || json === null) fail("it is not a JSON object");
  const raw = json as Record<string, unknown>;
  if (raw.routes !== undefined) {
    if (raw.kind !== "testnet") fail(`"routes" is for a testnet config; devnet.json has a single route`);
    return parseTestnetRoutes(raw);
  }
  const route = parseDevnetEnv(raw);
  return { kind: route.kind, routes: [route], testWallet: route.testWallet, scannerUrl: route.scannerUrl };
}

/** Link to a transaction in the chain's block explorer; null when the chain has none (the devnet). */
export function explorerTxUrl(chain: Pick<DevnetChainEnv, "explorerUrl">, hash: string): string | null {
  return chain.explorerUrl ? `${chain.explorerUrl}/tx/${hash}` : null;
}

/**
 * Link to the cross-chain message a transaction dispatched, in Veashi Scanner (`/tx/<source chain id>/<source tx>`);
 * null without a scanner (the devnet, a testnet config without `scannerUrl`, or a route the scanner does not know).
 */
export function scannerTxUrl(scannerUrl: string | null, chainId: number, hash: string): string | null {
  return scannerUrl ? `${scannerUrl}/tx/${chainId}/${hash}` : null;
}
