import { describe, expect, it } from "vitest";
import { DEV_ACCOUNT } from "./chain";
import { sampleEnv } from "./testing";
import { createSwitchData, createWagmiConfig } from "./index";

describe("createWagmiConfig", () => {
  it("offers only the injected connector without the test wallet", () => {
    const config = createWagmiConfig({ ...sampleEnv(), testWallet: false });
    expect(config.connectors.map((c) => c.type)).toEqual(["injected"]);
  });
  it("adds the test connector (dev account) when env.testWallet", async () => {
    const config = createWagmiConfig(sampleEnv());
    expect(config.connectors.map((c) => c.type)).toEqual(["injected", "mock"]);
    const provider = (await config.connectors[1].getProvider()) as { request: (a: { method: string }) => Promise<unknown> };
    await expect(provider.request({ method: "eth_requestAccounts" })).resolves.toEqual([DEV_ACCOUNT]);
  });
  it("has the two devnet chains, foreign first, on their local RPCs", () => {
    const config = createWagmiConfig(sampleEnv());
    expect(config.chains.map((c) => [c.id, c.rpcUrls.default.http[0]])).toEqual([
      [84530001, "http://127.0.0.1:8645"],
      [421610001, "http://localhost:8646"],
    ]);
  });
  it("refuses a non-local RPC", () => {
    const env = sampleEnv();
    env.foreign.rpcUrl = "https://mainnet.base.org";
    expect(() => createWagmiConfig(env)).toThrow(/not a local URL/);
  });
});

describe("createSwitchData", () => {
  it("describes the chains without explorers and exposes devnet.rule only with the test wallet", () => {
    const env = sampleEnv();
    const data = createSwitchData(env, createWagmiConfig(env));
    expect(data.chains().foreign).toEqual({
      key: "foreign",
      id: 84530001,
      name: "Base-like",
      rpcUrl: "http://127.0.0.1:8645",
      explorerTxUrl: null,
    });
    expect(data.chains().home.key).toBe("home");
    expect(typeof data.devnet?.rule).toBe("function");
    const off = { ...env, testWallet: false };
    expect(createSwitchData(off, createWagmiConfig(off)).devnet).toBeUndefined();
  });
});
