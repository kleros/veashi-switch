import { afterEach, describe, expect, it, vi } from "vitest";
import { explorerTxUrl, isLocalRpcUrl, parseDevnetEnv, scannerTxUrl } from "./env";
import { SwitchError } from "./errors";
import { createSwitchData, createWagmiConfig, loadDevnetEnv, loadEnv, missingContracts } from "./index";
import { A, sampleEnv } from "./testing";

describe("DevnetEnv parsing", () => {
  it("accepts what devnet.sh writes", () => {
    const env = parseDevnetEnv(sampleEnv());
    expect(env.foreign.chainId).toBe(84530001);
    expect(env.addresses.home.KlerosCoreRuler).toBe(A(7));
    expect(env.testWallet).toBe(true);
    expect(env.foreign.name).toBe("Base-like");
    expect(env.home.name).toBe("Arbitrum-like");
  });
  it("treats a config without kind as the devnet", () => {
    const env = parseDevnetEnv(sampleEnv());
    expect(env.kind).toBe("devnet");
    expect(env.foreign).toMatchObject({ explorerUrl: null, fromBlock: 0n });
    expect(explorerTxUrl(env.foreign, "0xabc")).toBeNull();
    expect(parseDevnetEnv({ ...sampleEnv(), kind: "devnet" }).kind).toBe("devnet");
  });
  it("rejects an unknown kind", () => {
    expect(() => parseDevnetEnv({ ...sampleEnv(), kind: "mainnet" })).toThrow(/kind/);
  });
  it("only allows 127.0.0.1 and localhost RPC URLs", () => {
    expect(isLocalRpcUrl("http://127.0.0.1:8645")).toBe(true);
    expect(isLocalRpcUrl("http://localhost:1234")).toBe(true);
    for (const url of ["https://mainnet.base.org", "http://10.0.0.2:8545", "http://127.0.0.1.evil.io:8545", "not a url"]) {
      expect(isLocalRpcUrl(url)).toBe(false);
    }
  });
  it("rejects a public RPC URL", () => {
    const env = sampleEnv();
    env.home.rpcUrl = "https://arb1.arbitrum.io/rpc";
    expect(() => parseDevnetEnv(env)).toThrow(/not a local URL/);
  });
  it("rejects missing contracts and bad addresses", () => {
    const missing = sampleEnv() as ReturnType<typeof sampleEnv> & { addresses: { foreign: Record<string, string> } };
    delete (missing.addresses.foreign as Record<string, string>).GatewayLightbulb;
    expect(() => parseDevnetEnv(missing)).toThrow(/GatewayLightbulb/);
    const bad = sampleEnv();
    bad.addresses.home.Yaru = "0x1234";
    expect(() => parseDevnetEnv(bad)).toThrow(/not an address/);
  });
  it("treats anything but testWallet: true as false", () => {
    expect(parseDevnetEnv({ ...sampleEnv(), testWallet: "yes" }).testWallet).toBe(false);
  });
});

describe("loadDevnetEnv", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubFetch = (impl: () => Promise<unknown>) => vi.stubGlobal("fetch", vi.fn(impl));

  it("fetches /devnet.json and parses it", async () => {
    stubFetch(async () => ({ ok: true, json: async () => sampleEnv() }));
    await expect(loadDevnetEnv()).resolves.toMatchObject({ testWallet: true });
    expect(fetch).toHaveBeenCalledWith("/devnet.json", { cache: "no-store" });
  });
  it("rejects in plain language when the devnet is not running", async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    await expect(loadDevnetEnv()).rejects.toThrow(/devnet is not running/);
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(loadDevnetEnv()).rejects.toThrow(/devnet is not running/);
  });
  it("rejects a devnet.json pointing at a non-local RPC", async () => {
    const env = sampleEnv();
    env.foreign.rpcUrl = "https://mainnet.base.org";
    stubFetch(async () => ({ ok: true, json: async () => env }));
    await expect(loadDevnetEnv()).rejects.toThrow(/only 127.0.0.1 or localhost/);
  });
});

const testnetJson = () => ({
  kind: "testnet",
  foreign: {
    chainId: 84532,
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org/",
    fromBlock: 123,
  },
  home: {
    chainId: 421614,
    name: "Arbitrum Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorerUrl: "https://sepolia.arbiscan.io",
    fromBlock: "456",
  },
  addresses: sampleEnv().addresses,
});

describe("testnet config parsing", () => {
  it("accepts a filled-in testnet config", () => {
    const env = parseDevnetEnv(testnetJson());
    expect(env.kind).toBe("testnet");
    expect(env.testWallet).toBe(false);
    expect(env.foreign).toMatchObject({ chainId: 84532, fromBlock: 123n, explorerUrl: "https://sepolia.basescan.org" });
    expect(env.home.fromBlock).toBe(456n);
    expect(explorerTxUrl(env.home, "0xabc")).toBe("https://sepolia.arbiscan.io/tx/0xabc");
  });
  it("never enables the test wallet", () => {
    expect(parseDevnetEnv({ ...testnetJson(), testWallet: true }).testWallet).toBe(false);
  });
  it("refuses mainnets and unknown chains", () => {
    for (const id of [1, 8453, 42161, 31337]) {
      const json = testnetJson();
      json.foreign.chainId = id;
      expect(() => parseDevnetEnv(json)).toThrow(/not a supported public testnet/);
    }
  });
  it("requires https RPC and explorer URLs", () => {
    for (const url of ["http://sepolia.base.org", "http://127.0.0.1:8545", "wss://x.example", "nope"]) {
      const json = testnetJson();
      json.foreign.rpcUrl = url;
      expect(() => parseDevnetEnv(json)).toThrow(/rpcUrl/);
    }
    const json = testnetJson();
    json.home.explorerUrl = "http://sepolia.arbiscan.io";
    expect(() => parseDevnetEnv(json)).toThrow(/explorerUrl/);
  });
  it("requires fromBlock to be a non-negative whole number", () => {
    for (const bad of [-1, 1.5, "abc", "-3", null]) {
      const json = testnetJson();
      (json.foreign as Record<string, unknown>).fromBlock = bad;
      expect(() => parseDevnetEnv(json)).toThrow(/fromBlock/);
    }
  });
  it("accepts placeholder contract addresses and leaves them out, so the site still boots", () => {
    const json = testnetJson();
    const addresses = json.addresses as { foreign: Record<string, string>; home: Record<string, string> };
    addresses.foreign.GatewayLightbulb = "";
    addresses.foreign.USDC = "0x0000000000000000000000000000000000000000";
    delete addresses.home.KlerosCoreRuler;
    const env = parseDevnetEnv(json);
    expect(env.kind).toBe("testnet");
    expect(env.addresses.foreign.GatewayLightbulb).toBeUndefined();
    expect(env.addresses.foreign.USDC).toBeUndefined();
    expect(env.addresses.home.KlerosCoreRuler).toBeUndefined();
    expect(env.addresses.foreign.ForeignGateway).toBe(addresses.foreign.ForeignGateway);
  });
  it("ignores blank optional addresses but rejects malformed ones", () => {
    const json = testnetJson();
    (json.addresses.foreign as Record<string, string>).CCIPReporter = "";
    expect(parseDevnetEnv(json).addresses.foreign.CCIPReporter).toBeUndefined();
    (json.addresses.foreign as Record<string, string>).CCIPReporter = "0x12";
    expect(() => parseDevnetEnv(json)).toThrow(/not an address/);
  });
});

describe("Veashi Scanner config", () => {
  const SCANNER = "https://veashi-scanner.vercel.app";
  const HASH = "0xf0eb86ade99d5dc4e800e2e59ad8977f46fce55523878c09a6228eb81ab28b2f";
  const withScanner = (scannerUrl: unknown) => ({ ...testnetJson(), scannerUrl });

  it("accepts an https scannerUrl and strips trailing slashes", () => {
    expect(parseDevnetEnv(withScanner(SCANNER)).scannerUrl).toBe(SCANNER);
    expect(parseDevnetEnv(withScanner(`${SCANNER}//`)).scannerUrl).toBe(SCANNER);
    expect(parseDevnetEnv(withScanner("https://scan.example/veashi/")).scannerUrl).toBe("https://scan.example/veashi");
  });
  it("is optional: absent, null or blank means no scanner", () => {
    expect(parseDevnetEnv(testnetJson()).scannerUrl).toBeNull();
    expect(parseDevnetEnv(withScanner(null)).scannerUrl).toBeNull();
    expect(parseDevnetEnv(withScanner("")).scannerUrl).toBeNull();
  });
  it("rejects a scannerUrl that is not https, or that has a query or fragment", () => {
    for (const bad of ["http://veashi-scanner.vercel.app", "ftp://x.example", "javascript:alert(1)", "veashi-scanner.vercel.app", 42, true]) {
      expect(() => parseDevnetEnv(withScanner(bad))).toThrow(/scannerUrl.*https/);
    }
    for (const bad of [`${SCANNER}/?x=1`, `${SCANNER}#top`]) {
      expect(() => parseDevnetEnv(withScanner(bad))).toThrow(/scannerUrl.*query or a fragment/);
    }
  });
  it("is never set on the devnet, whatever devnet.json says", () => {
    expect(parseDevnetEnv({ ...sampleEnv(), scannerUrl: SCANNER }).scannerUrl).toBeNull();
  });
  it("builds /tx/<source chain id>/<source tx>, or null without a scanner", () => {
    expect(scannerTxUrl(SCANNER, 84532, HASH)).toBe(`${SCANNER}/tx/84532/${HASH}`);
    expect(scannerTxUrl(null, 84532, HASH)).toBeNull();
  });
  it("gives each chain a scanner link with its own chain id, and survives the re-parse in createSwitchData", () => {
    const env = parseDevnetEnv(withScanner(`${SCANNER}/`));
    const chains = createSwitchData(env, createWagmiConfig(env)).chains();
    expect(chains.foreign.scannerTxUrl?.(HASH)).toBe(`${SCANNER}/tx/84532/${HASH}`);
    expect(chains.home.scannerTxUrl?.(HASH)).toBe(`${SCANNER}/tx/421614/${HASH}`);
    const none = parseDevnetEnv(testnetJson());
    expect(createSwitchData(none, createWagmiConfig(none)).chains().foreign.scannerTxUrl).toBeNull();
    const devnet = parseDevnetEnv(sampleEnv());
    const devChains = createSwitchData(devnet, createWagmiConfig(devnet)).chains();
    expect(devChains.foreign.scannerTxUrl).toBeNull();
    expect(devChains.home.scannerTxUrl).toBeNull();
  });
});

describe("loadEnv on a testnet build", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads the bundled config, never /devnet.json, and every required contract is set in it", async () => {
    vi.stubEnv("VITE_VEASHI_NETWORK", "testnet");
    vi.stubGlobal("fetch", vi.fn());
    const env = await loadEnv();
    expect(env.kind).toBe("testnet");
    expect(env.foreign.chainId).toBe(84532);
    expect(env.home.chainId).toBe(421614);
    expect(missingContracts(env)).toEqual([]);
    expect(env.scannerUrl).toBe("https://veashi-scanner.vercel.app");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("with blank contract addresses, every read rejects naming the unset contracts and nothing reaches an RPC", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const json = testnetJson();
    const addresses = json.addresses as { foreign: Record<string, string>; home: Record<string, string> };
    for (const name of ["ForeignGateway", "GatewayLightbulb", "USDC"]) addresses.foreign[name] = "";
    for (const name of ["HomeGateway", "KlerosCoreRuler"]) addresses.home[name] = "";
    const env = parseDevnetEnv(json);
    const data = createSwitchData(env, createWagmiConfig(env));
    expect(missingContracts(env)).toContain("foreign.ForeignGateway");
    expect(data.chains().foreign.id).toBe(84532);
    await expect(data.oracles()).rejects.toBeInstanceOf(SwitchError);
    await expect(data.requests(A(1))).rejects.toThrow(/foreign\.GatewayLightbulb.*config\/testnet\.json/);
    await expect(data.request(1n)).rejects.toThrow(/not set up on the test networks yet/);
    expect(data.watchRequest(1n, () => {})).toBeTypeOf("function");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("still validates an RPC override as https", async () => {
    vi.stubEnv("VITE_VEASHI_NETWORK", "testnet");
    vi.stubEnv("VITE_VEASHI_HOME_RPC", "http://127.0.0.1:8545");
    await expect(loadEnv()).rejects.toThrow(/home\.rpcUrl/);
  });
});
