import { afterEach, describe, expect, it, vi } from "vitest";
import { explorerTxUrl, isLocalRpcUrl, NotConfiguredError, parseDevnetEnv } from "./env";
import { loadDevnetEnv, loadEnv } from "./index";
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
  it("throws NotConfiguredError naming the missing contracts when addresses are placeholders", () => {
    const json = testnetJson();
    const addresses = json.addresses as { foreign: Record<string, string>; home: Record<string, string> };
    addresses.foreign.GatewayLightbulb = "";
    addresses.foreign.USDC = "0x0000000000000000000000000000000000000000";
    delete addresses.home.KlerosCoreRuler;
    const run = () => parseDevnetEnv(json);
    expect(run).toThrow(NotConfiguredError);
    expect(run).toThrow(/foreign\.GatewayLightbulb, foreign\.USDC, home\.KlerosCoreRuler/);
    expect(run).toThrow(/config\/testnet\.json/);
    expect(run).not.toThrow(/yarn devnet/);
  });
  it("ignores blank optional addresses but rejects malformed ones", () => {
    const json = testnetJson();
    (json.addresses.foreign as Record<string, string>).CCIPReporter = "";
    expect(parseDevnetEnv(json).addresses.foreign.CCIPReporter).toBeUndefined();
    (json.addresses.foreign as Record<string, string>).CCIPReporter = "0x12";
    expect(() => parseDevnetEnv(json)).toThrow(/not an address/);
  });
});

describe("loadEnv on a testnet build", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads the bundled config, never /devnet.json, and reports the shipped placeholders as not configured", async () => {
    vi.stubEnv("VITE_VEASHI_NETWORK", "testnet");
    vi.stubGlobal("fetch", vi.fn());
    await expect(loadEnv()).rejects.toBeInstanceOf(NotConfiguredError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("still validates an RPC override as https", async () => {
    vi.stubEnv("VITE_VEASHI_NETWORK", "testnet");
    vi.stubEnv("VITE_VEASHI_HOME_RPC", "http://127.0.0.1:8545");
    await expect(loadEnv()).rejects.toThrow(/home\.rpcUrl/);
  });
});
