// Several routes in one config: Base Sepolia and Arc testnet, both with their court on Arbitrum Sepolia. The parsing,
// the shipped config/testnet.json, the wagmi chains, and the Arc route's quote in its own gas token (its RPC answered
// in-process: fetch is stubbed, so no request leaves the test).
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, type Abi, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import shipped from "../../config/testnet.json";
import { costBreakdown } from "../components/costModel";
import { foreignGatewayAbi, lightbulbAbi } from "./abi";
import { isJurorGuidedLightbulb, parseDevnetEnv, parseNetworkEnv } from "./env";
import { describeRevert } from "./errors";
import { applyRpcOverrides, createRoutes, createWagmiConfig, loadNetwork, missingContracts } from "./index";
import { arcTestnet } from "./networks";
import { A, sampleEnv } from "./testing";

const BASE_LB = "0x9b2F1d258F7ded62874807c6DD15247b5C6Cff37";

const chain = (chainId: number, name: string, rpcUrl: string, explorerUrl: string, extra: Record<string, unknown> = {}) => ({
  chainId,
  name,
  rpcUrl,
  explorerUrl,
  ...extra,
});
const arb = (addresses: Record<string, string>, fromBlock = 456) => ({
  ...chain(421614, "Arbitrum Sepolia", "https://sepolia-rollup.arbitrum.io/rpc", "https://sepolia.arbiscan.io"),
  fromBlock,
  addresses,
});

const GATEWAY = A(21);
const LIGHTBULB = A(22);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a JSON config, edited freely by the refusal cases
type Json = { kind: string; scannerUrl: string; routes: { id: string; foreign: any; home: any; [key: string]: unknown }[] };

/** Two routes as config/testnet.json lists them; the address collision of the live testnet is kept on purpose. */
const twoRoutes = (): Json => ({
  kind: "testnet",
  scannerUrl: "https://veashi-scan.example",
  routes: [
    {
      id: "base",
      foreign: {
        ...chain(84532, "Base Sepolia", "https://sepolia.base.org", "https://sepolia.basescan.org"),
        fromBlock: 123,
        addresses: { ForeignGateway: A(1), GatewayLightbulb: BASE_LB, GatewayLightbulbV2: "", USDC: A(3), Yaho: A(4), Yaru: A(5) },
      },
      home: arb({ HomeGateway: BASE_LB, KlerosCoreRuler: A(7), Yaho: A(8), Yaru: A(9) }),
    },
    {
      id: "arc",
      scannerUrl: "",
      jurorGuide: ["GatewayLightbulb"],
      foreign: {
        ...chain(5042002, "Arc Testnet", "https://rpc.testnet.arc.network", "https://explorer.testnet.arc.io"),
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        logRange: 10000,
        fromBlock: 74009682,
        // the Arc ForeignGateway has the Base lightbulb's (and HomeGateway 1's) address on its own chain
        addresses: { ForeignGateway: BASE_LB, GatewayLightbulb: LIGHTBULB, Yaho: A(24), Yaru: A(25) },
      },
      home: arb({ HomeGateway: A(26), KlerosCoreRuler: A(7), Yaho: A(8), Yaru: A(29) }, 332549495),
    },
  ],
});

describe("a config with several routes", () => {
  it("parses each route with its own chains, addresses, fromBlocks, scanner and juror lightbulbs", () => {
    const net = parseNetworkEnv(twoRoutes());
    expect(net.kind).toBe("testnet");
    expect(net.routes.map((r) => r.id)).toEqual(["base", "arc"]);
    const [base, arc] = net.routes;
    expect(base.foreign).toMatchObject({ chainId: 84532, fromBlock: 123n, logRange: null, nativeCurrency: { symbol: "ETH", decimals: 18 } });
    expect(base.home).toMatchObject({ chainId: 421614, fromBlock: 456n });
    expect(base.addresses.home.HomeGateway).toBe(BASE_LB);
    expect(base.addresses.foreign.GatewayLightbulbV2).toBeUndefined();
    expect(base.scannerUrl).toBe("https://veashi-scan.example");
    expect(base.jurorGuide).toEqual(["GatewayLightbulbV2"]);
    expect(arc.foreign).toMatchObject({
      chainId: 5042002,
      fromBlock: 74009682n,
      logRange: 10000n,
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    });
    expect(arc.home).toMatchObject({ chainId: 421614, fromBlock: 332549495n });
    expect(arc.addresses.home.HomeGateway).toBe(A(26));
    expect(arc.addresses.foreign.USDC).toBeUndefined();
    expect(arc.scannerUrl).toBeNull(); // the scanner does not know the Arc pair: no scanner links there
    expect(arc.jurorGuide).toEqual(["GatewayLightbulb"]);
    expect(isJurorGuidedLightbulb(arc.addresses.foreign, LIGHTBULB, arc.jurorGuide)).toBe(true);
    expect(isJurorGuidedLightbulb(base.addresses.foreign, BASE_LB, base.jurorGuide)).toBe(false);
    // parseDevnetEnv on a routes config gives the default route, so single-route code keeps working
    expect(parseDevnetEnv(twoRoutes()).id).toBe("base");
  });

  it("re-parses a parsed route to the same route (createSwitchData parses what it is given again)", () => {
    for (const route of parseNetworkEnv(twoRoutes()).routes) expect(parseDevnetEnv(route)).toEqual(route);
  });

  it("refuses malformed routes in plain language", () => {
    const cases: [string, (j: Json) => void, RegExp][] = [
      ["empty list", (j) => void (j.routes = []), /"routes" must be a list/],
      ["duplicate id", (j) => void (j.routes[1].id = "base"), /routes\[1\]\.id.*used by another route/],
      ["id that reads as a number", (j) => void (j.routes[1].id = "2"), /routes\[1\]\.id.*lowercase slug/],
      ["id with a slash", (j) => void (j.routes[1].id = "arc/x"), /routes\[1\]\.id/],
      ["missing id", (j) => void delete (j.routes[1] as { id?: string }).id, /routes\[1\]\.id" is missing/],
      ["a mainnet", (j) => void (j.routes[1].foreign.chainId = 5042), /routes\[1\]\.foreign\.chainId.*not a supported public testnet/],
      ["http RPC", (j) => void (j.routes[1].foreign.rpcUrl = "http://rpc.testnet.arc.network"), /routes\[1\]\.foreign\.rpcUrl/],
      ["bad address", (j) => void ((j.routes[1].foreign.addresses as Record<string, string>).Yaru = "0x12"), /routes\[1\]\.foreign\.addresses\.Yaru/],
      ["the home chain set up twice", (j) => void (j.routes[1].home.rpcUrl = "https://other.example/rpc"), /routes\[1\]\.home.*differently.*rpcUrl/],
      ["a gas token that is not the chain's", (j) => void (j.routes[1].foreign.nativeCurrency = { name: "Ether", symbol: "ETH", decimals: 18 }), /nativeCurrency.*not the chain's gas token \(USDC, 18 decimals\)/],
      ["USDC with 6 decimals as the gas token", (j) => void (j.routes[1].foreign.nativeCurrency.decimals = 6), /not the chain's gas token/],
      ["a bad logRange", (j) => void (j.routes[1].foreign.logRange = -1), /logRange/],
      ["a bad jurorGuide", (j) => void ((j.routes[1] as Record<string, unknown>).jurorGuide = "GatewayLightbulb"), /jurorGuide/],
      ["a bad manualRelay", (j) => void ((j.routes[1] as Record<string, unknown>).manualRelay = "yes"), /routes\[1\]\.manualRelay.*true or false/],
      ["a bad route scannerUrl", (j) => void ((j.routes[1] as Record<string, unknown>).scannerUrl = "http://x.example"), /routes\[1\]\.scannerUrl.*https/],
      ["top-level addresses next to routes", (j) => void ((j as Record<string, unknown>).addresses = {}), /"addresses" belongs inside each route/],
    ];
    for (const [what, edit, error] of cases) {
      const json = twoRoutes();
      edit(json);
      expect(() => parseNetworkEnv(json), what).toThrow(error);
    }
    expect(() => parseNetworkEnv({ ...sampleEnv(), routes: [] })).toThrow(/"routes" is for a testnet config/);
  });

  it("gives Arc testnet its USDC gas token even when the config leaves nativeCurrency out", () => {
    const json = twoRoutes();
    delete (json.routes[1].foreign as Record<string, unknown>).nativeCurrency;
    expect(parseNetworkEnv(json).routes[1].foreign.nativeCurrency).toEqual({ name: "USDC", symbol: "USDC", decimals: 18 });
  });

  it("devnet.json and a single-route testnet config are one route, the default", () => {
    const devnet = parseNetworkEnv(sampleEnv());
    expect(devnet.routes.map((r) => [r.id, r.kind])).toEqual([["default", "devnet"]]);
    expect(devnet.routes[0].foreign.nativeCurrency.symbol).toBe("ETH");
  });

  it("one wagmi chain per chain id, Arc with its USDC gas token and explorer", () => {
    const net = parseNetworkEnv(twoRoutes());
    const config = createWagmiConfig(net);
    expect(config.chains.map((c) => c.id)).toEqual([84532, 421614, 5042002]);
    const arc = config.chains.find((c) => c.id === 5042002)!;
    expect(arc.nativeCurrency).toEqual({ name: "USDC", symbol: "USDC", decimals: 18 });
    expect(arc.blockExplorers?.default.url).toBe("https://explorer.testnet.arc.io");
    expect(arc.rpcUrls.default.http).toEqual(["https://rpc.testnet.arc.network"]);
    expect(arcTestnet.id).toBe(5042002);
    expect(config.connectors.map((c) => c.type)).toEqual(["injected"]);
  });

  it("each route's data names its own chains, explorers, gas token and scanner", () => {
    const net = parseNetworkEnv(twoRoutes());
    const [base, arc] = createRoutes(net, createWagmiConfig(net));
    expect([base.id, base.isDefault, arc.id, arc.isDefault]).toEqual(["base", true, "arc", false]);
    expect(base.missing).toEqual([]);
    expect(arc.missing).toEqual([]); // set up without a USDC entry
    const hash = `0x${"ab".repeat(32)}` as Hex;
    const a = arc.data.chains();
    expect(a.foreign).toMatchObject({ id: 5042002, name: "Arc Testnet", nativeCurrency: { symbol: "USDC", decimals: 18 } });
    expect(a.foreign.explorerTxUrl?.(hash)).toBe(`https://explorer.testnet.arc.io/tx/${hash}`);
    expect(a.home.explorerTxUrl?.(hash)).toBe(`https://sepolia.arbiscan.io/tx/${hash}`);
    expect(a.foreign.scannerTxUrl).toBeNull();
    expect(a.home.scannerTxUrl).toBeNull();
    expect(base.data.chains().foreign.scannerTxUrl?.(hash)).toBe(`https://veashi-scan.example/tx/84532/${hash}`);
    expect(base.data.payTokens()).toEqual(["native", "usdc"]);
    expect(arc.data.payTokens()).toEqual(["native"]);
  });

  it("an Arc route not deployed yet is listed as not set up, and never calls its RPC", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const json = twoRoutes();
    json.routes[1].foreign.addresses.ForeignGateway = "";
    json.routes[1].home.addresses.HomeGateway = "";
    const net = parseNetworkEnv(json);
    const arc = createRoutes(net, createWagmiConfig(net))[1];
    expect(arc.missing).toEqual(["foreign.ForeignGateway", "home.HomeGateway"]);
    await expect(arc.data.request(1n)).rejects.toThrow(/not set up/);
    await expect(arc.data.caseRequest(1n)).rejects.toThrow(/not set up/);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("RPC overrides from the build", () => {
  it("FOREIGN applies to the default route only, HOME to every route whose court is on that chain, RPC_<id> to any chain", () => {
    const vars = { VITE_VEASHI_FOREIGN_RPC: "https://key.example/base", VITE_VEASHI_HOME_RPC: "https://key.example/arb" };
    const net = parseNetworkEnv(applyRpcOverrides(twoRoutes(), vars));
    expect(net.routes[0].foreign.rpcUrl).toBe("https://key.example/base");
    expect(net.routes[1].foreign.rpcUrl).toBe("https://rpc.testnet.arc.network");
    expect(net.routes.map((r) => r.home.rpcUrl)).toEqual(["https://key.example/arb", "https://key.example/arb"]);
    const byId = parseNetworkEnv(applyRpcOverrides(twoRoutes(), { ...vars, VITE_VEASHI_RPC_5042002: "https://key.example/arc" }));
    expect(byId.routes[1].foreign.rpcUrl).toBe("https://key.example/arc");
    // another RPC has its own getLogs limit
    expect(byId.routes[1].foreign.logRange).toBeNull();
    expect(() => parseNetworkEnv(applyRpcOverrides(twoRoutes(), { VITE_VEASHI_RPC_5042002: "http://127.0.0.1:8545" }))).toThrow(
      /routes\[1\]\.foreign\.rpcUrl/,
    );
  });
});

describe("the shipped config/testnet.json", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("has Base Sepolia as the default route, unchanged, and Arc testnet next, both set up, with their court on Arbitrum Sepolia", async () => {
    vi.stubEnv("VITE_VEASHI_NETWORK", "testnet");
    vi.stubGlobal("fetch", vi.fn());
    const net = await loadNetwork();
    expect(net.routes.map((r) => [r.id, r.foreign.chainId, r.home.chainId])).toEqual([
      ["base", 84532, 421614],
      ["arc", 5042002, 421614],
    ]);
    for (const route of net.routes) expect(missingContracts(route)).toEqual([]);
    const [base, arc] = net.routes;
    // the Base route as it was before Arc (its requests' and court cases' links depend on it)
    expect(base.addresses.foreign).toMatchObject({
      ForeignGateway: "0xD2065e625D19eF00AA0b9E4cCb51D79a56b8343a",
      GatewayLightbulb: BASE_LB,
      USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    });
    expect(base.addresses.home.HomeGateway).toBe(BASE_LB);
    expect([base.foreign.fromBlock, base.home.fromBlock]).toEqual([62544707n, 331953930n]);
    expect(base.scannerUrl).toBe("https://veashi-scan.netlify.app");
    // Arc: its own HomeGateway (HG2) on the shared court chain, its gas token, no scanner, the juror line on its lightbulb
    expect(arc.addresses.home.HomeGateway).toBe("0x4c36FFA35Ce17CbDEeEB3582288828B933faCbA5");
    expect(arc.addresses.foreign.GatewayLightbulb).toBe("0xB431C5907B76811164034fAaB763064364f9d4CD");
    expect(arc.addresses.foreign.USDC).toBeUndefined();
    expect(arc.home.fromBlock).toBe(332549495n);
    expect(arc.foreign).toMatchObject({ fromBlock: 74009682n, logRange: 10000n, nativeCurrency: { symbol: "USDC", decimals: 18 } });
    expect(arc.scannerUrl).toBeNull();
    expect(isJurorGuidedLightbulb(arc.addresses.foreign, arc.addresses.foreign.GatewayLightbulb, arc.jurorGuide)).toBe(true);
    // no relay service runs the Arc route's steps (yet): Track promises none there
    expect([base.manualRelay, arc.manualRelay]).toEqual([false, true]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is the file the build bundles", () => {
    expect((shipped as { routes: unknown[] }).routes).toHaveLength(2);
  });
});

// The Arc route's ForeignGateway, answered from the values the live one returned on 25 Nov 2026: court 8 with 3
// jurors, feeForJuror 2.7e14 (home native), homeNativeRate 2.5e21 (1 ETH = 2500 USDC, both 18 decimals), one oracle
// (Axelar, id 0) whose round trip costs 5.2e17 Arc-wei (0.52 USDC).
const FEE_FOR_JUROR = 270_000_000_000_000n;
const HOME_NATIVE_RATE = 2_500n * 10n ** 18n;
const BRIDGING = 520_000_000_000_000_000n;
const TOTAL = 2_545_000_000_000_000_000n;
const ABIS: Abi[] = [foreignGatewayAbi as Abi, lightbulbAbi as Abi];

function answer(to: string, data: Hex): Hex {
  for (const abi of ABIS) {
    let call: { functionName: string; args?: readonly unknown[] };
    try {
      call = decodeFunctionData({ abi, data }) as typeof call;
    } catch {
      continue;
    }
    const values: Record<string, unknown> = {
      arbitratorExtraData: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [8n, 3n]),
      getDefaultOracles: { oracleIDs: [0n], threshold: 1n },
      arbitrationCost: TOTAL,
      feeForJuror: (call.args?.[0] as bigint) === 8n ? FEE_FOR_JUROR : 0n,
      homeNativeRate: HOME_NATIVE_RATE,
      oracleBridgingCost: BRIDGING,
    };
    if (!(call.functionName in values)) throw new Error(`unexpected call ${call.functionName} to ${to}`);
    const fns = (abi as readonly { type: string; name?: string; inputs?: readonly unknown[] }[]).filter(
      (f) => f.type === "function" && f.name === call.functionName,
    );
    const item = fns.find((f) => (f.inputs?.length ?? 0) === (call.args?.length ?? 0)) ?? fns[0];
    return encodeFunctionResult({ abi: [item] as Abi, functionName: call.functionName, result: values[call.functionName] } as never);
  }
  throw new Error(`no ABI decodes the call to ${to}`);
}

/** Answers eth_call (and eth_chainId, eth_getBalance) for the Arc RPC only; anything else fails the test. */
function stubArcRpc() {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push(request.url);
      if (!request.url.startsWith("https://rpc.testnet.arc.network")) throw new Error(`unexpected RPC ${request.url}`);
      const body = (await request.json()) as { id: number; method: string; params: [{ to: string; data: Hex }] };
      const reply = (one: typeof body) => {
        if (one.method === "eth_chainId") return { jsonrpc: "2.0", id: one.id, result: "0x4cef52" };
        if (one.method === "eth_getBalance") return { jsonrpc: "2.0", id: one.id, result: "0x2386f26fc10000" }; // 0.01
        if (one.method !== "eth_call") throw new Error(`unexpected method ${one.method}`);
        return { jsonrpc: "2.0", id: one.id, result: answer(one.params[0].to, one.params[0].data) };
      };
      const out = Array.isArray(body) ? body.map(reply) : reply(body);
      return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
    }),
  );
  return seen;
}

const arcData = () => {
  const json = twoRoutes();
  json.routes[1].foreign.addresses.ForeignGateway = GATEWAY;
  const net = parseNetworkEnv(json);
  return createRoutes(net, createWagmiConfig(net))[1].data;
};

describe("the Arc route's quote and balance", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is in the gas token, USDC with 18 decimals (not ETH, not the 6 of Arc's USDC token), and its parts add up", async () => {
    const seen = stubArcRpc();
    const q = await arcData().quote(null, "native");
    expect(q).toMatchObject({ token: "native", symbol: "USDC", decimals: 18, total: TOTAL });
    expect(q.jurorFees).toBe(2_025_000_000_000_000_000n); // 2.7e14 × 3 × 2.5e21 / 1e18
    expect(q.bridging).toEqual([{ oracleId: 0, amount: BRIDGING }]);
    const shown = costBreakdown(q, () => "Axelar");
    expect(shown.lines.map((l) => [l.label, l.text])).toEqual([
      ["Juror fees", "2.025"],
      ["Axelar", "0.520"],
    ]);
    expect(shown.total).toBe("2.545 USDC");
    expect(seen.every((u) => u.startsWith("https://rpc.testnet.arc.network"))).toBe(true);
  });

  it("reads the owner's gas-token balance on Arc", async () => {
    stubArcRpc();
    await expect(arcData().balance(A(77))).resolves.toBe(10_000_000_000_000_000n);
  });

  it("refuses the USDC token on a route that has none, before any send or token read", async () => {
    const seen: string[] = [];
    stubArcRpc();
    const fetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push(JSON.stringify(await request.clone().json()));
      return fetch(request);
    });
    const arc = arcData();
    await expect(arc.quote(null, "usdc")).rejects.toThrow(/takes no USDC token: pay in Arc Testnet's own gas token \(USDC\)/);
    await expect(arc.usdcAllowance(A(1))).rejects.toThrow(/takes no USDC token/);
    await expect(arc.approveUsdc(1n)).rejects.toThrow(/takes no USDC token/);
    await expect(arc.requestSwitch(null, "usdc")).rejects.toThrow(/takes no USDC token/);
    // only the error wording's oracle-name reads (eth_call): no quote, allowance, approval or send
    expect(seen.every((body) => body.includes('"eth_call"') || body.includes('"eth_chainId"'))).toBe(true);
    expect(seen.some((body) => body.includes("eth_sendTransaction"))).toBe(false);
  });
});

describe("error wording on a route whose gas token is USDC", () => {
  it("names the gas token of the chain the call ran on, and the court side's own", () => {
    const arc = { network: "testnet" as const, homeChainName: "Arbitrum Sepolia", nativeSymbol: "USDC", homeNativeSymbol: "ETH" };
    const reporter = describeRevert({ errorName: "ReporterCannotPay", args: ["Axelar", 2n * 10n ** 16n, 3n * 10n ** 15n] }, arc)!;
    expect(reporter).toMatch(/^This oracle's relay service lacks USDC for delivery/);
    expect(reporter).toContain("needs 0.02 USDC, holds 0.003 USDC");
    expect(reporter).not.toMatch(/ETH/);
    const court = describeRevert({ errorName: "InsufficientFunds", args: [10n ** 15n, 0n] }, arc)!;
    expect(court).toMatch(/lacks ETH to open the case/);
    expect(court).toContain("needs 0.001 ETH and holds 0 ETH");
    expect(describeRevert({ errorName: "TokenNotAccepted", args: [] }, arc)).toMatch(/Pay in USDC instead/);
    // unchanged without a gas token named (the Base route, the devnet)
    expect(describeRevert({ errorName: "TokenNotAccepted", args: [] })).toMatch(/Pay in ETH instead/);
  });
});
