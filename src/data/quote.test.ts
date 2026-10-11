import { encodeAbiParameters, parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { requestCall } from "./chain";
import { assembleQuote, decodeCourtAndJurors } from "./quote";

const USDC = "0x0000000000000000000000000000000000000003";

describe("quote assembly", () => {
  it("reads court and jurors from the lightbulb's extra data like the gateway", () => {
    const extra = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, 3n]);
    expect(decodeCourtAndJurors(extra)).toEqual({ courtId: 1n, jurors: 3n });
    expect(decodeCourtAndJurors("0x")).toEqual({ courtId: 0n, jurors: 3n });
    const noJurors = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, 0n]);
    expect(decodeCourtAndJurors(noJurors).jurors).toBe(3n);
  });

  const reads = {
    selection: null,
    oracleIds: [0, 1, 2],
    feeForJuror: parseEther("0.0009"),
    jurors: 3n,
    homeNativeRate: 10n ** 18n,
    bridgingCosts: { 0: parseEther("0.00042"), 1: parseEther("0.00118"), 2: parseEther("0.00086") },
  };

  it("native: juror fees and each oracle's round trip; the total is the contract's", () => {
    const q = assembleQuote({ ...reads, token: "native", toToken: (x) => x, total: parseEther("0.00516"), decimals: 18, symbol: "ETH" });
    expect(q.jurorFees).toBe(parseEther("0.0027"));
    expect(q.bridging).toEqual([
      { oracleId: 0, amount: parseEther("0.00042") },
      { oracleId: 1, amount: parseEther("0.00118") },
      { oracleId: 2, amount: parseEther("0.00086") },
    ]);
    expect(q.total).toBe(parseEther("0.00516"));
    expect(q.selection).toBeNull();
  });

  it("usdc: the parts are converted with the gateway's rate, decimals and symbol from the token", () => {
    const toToken = (wei: bigint) => (wei * 10n ** 6n) / ((10n ** 18n) / 2450n);
    const q = assembleQuote({ ...reads, token: "usdc", toToken, total: 12_642_000n, decimals: 6, symbol: "USDC" });
    expect(q.jurorFees).toBe(6_615_000n); // 0.0027 ETH × 2450
    expect(q.symbol).toBe("USDC");
    expect(q.decimals).toBe(6);
    expect(q.total).toBe(12_642_000n);
  });

  it("homeNativeRate scales juror fees", () => {
    const q = assembleQuote({ ...reads, homeNativeRate: 2n * 10n ** 18n, token: "native", toToken: (x) => x, total: 0n, decimals: 18, symbol: "ETH" });
    expect(q.jurorFees).toBe(parseEther("0.0054"));
  });
});

describe("requestSwitch sends the right overload", () => {
  it("default oracles, ETH: requestSwitch() with the quoted value", () => {
    expect(requestCall(null, "native", 9n, USDC)).toEqual({ functionName: "requestSwitch", args: [], value: 9n });
  });
  it("custom oracles, ETH: requestSwitch(ids, threshold) with the quoted value", () => {
    expect(requestCall({ oracleIds: [1, 3], threshold: 2 }, "native", 9n, USDC)).toEqual({
      functionName: "requestSwitch",
      args: [[1n, 3n], 2n],
      value: 9n,
    });
  });
  it("default oracles, USDC: requestSwitchWithToken(usdc), no value", () => {
    expect(requestCall(null, "usdc", 9n, USDC)).toEqual({ functionName: "requestSwitchWithToken", args: [USDC], value: 0n });
  });
  it("custom oracles, USDC: requestSwitchWithToken(ids, threshold, usdc), no value", () => {
    expect(requestCall({ oracleIds: [0, 2], threshold: 1 }, "usdc", 9n, USDC)).toEqual({
      functionName: "requestSwitchWithToken",
      args: [[0n, 2n], 1n, USDC],
      value: 0n,
    });
  });
});
