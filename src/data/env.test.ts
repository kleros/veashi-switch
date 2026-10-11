import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalRpcUrl, parseDevnetEnv } from "./env";
import { loadDevnetEnv } from "./index";
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
