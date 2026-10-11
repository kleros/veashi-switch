import { ContractFunctionExecutionError, ContractFunctionRevertedError, encodeErrorResult, parseEther, UserRejectedRequestError } from "viem";
import { describe, expect, it } from "vitest";
import { allErrorsAbi } from "./abi";
import { A, sampleEnv } from "./testing";
import { createSwitchData, createWagmiConfig } from "./index";
import { runRule, toFailure, type RuleDeps } from "./chain";
import { CANCELLED_BEFORE_SENDING, describeError, findRevert, MINED_REVERT, toSwitchError, withLead } from "./errors";

/** A revert as viem throws it from simulateContract/writeContract. */
function revert(errorName: string, args: readonly unknown[] = []) {
  const data = encodeErrorResult({ abi: allErrorsAbi, errorName, args } as never);
  const cause = new ContractFunctionRevertedError({ abi: allErrorsAbi, data, functionName: "requestSwitch" });
  return new ContractFunctionExecutionError(cause, { abi: allErrorsAbi, functionName: "requestSwitch", args: [] });
}

const first = (text: string) => text.split("\n")[0];

describe("reverts decode to plain language", () => {
  it("InsufficientPayment", () => {
    const text = describeError(revert("InsufficientPayment"));
    expect(first(text)).toMatch(/less than the cost/);
  });
  it("InvalidThreshold (the gateway's)", () => {
    expect(describeError(revert("InvalidThreshold"))).toMatch(/threshold must be between 1 and the number of oracles/);
  });
  it("the underfunded court side: plain first paragraph, detail after the newline", () => {
    const text = describeError(revert("InsufficientFunds", [parseEther("0.0027"), parseEther("0.001")]), {
      homeChainName: "Arbitrum-like",
    });
    expect(first(text)).toBe(
      "The court side of this local devnet lacks local ETH to open the case. The local operator needs to fund it.",
    );
    const detail = text.slice(text.indexOf("\n") + 1);
    expect(detail).toContain("HomeGateway on Arbitrum-like");
    expect(detail).toContain("0.0027 ETH");
    expect(detail).toContain("0.001 ETH");
  });
  it("a reporter that cannot pay", () => {
    const text = describeError(revert("ReporterCannotPay", ["LayerZero", parseEther("0.00043"), 0n]));
    expect(first(text)).toBe("This oracle's relay service lacks local ETH for delivery. The local operator needs to fund it.");
    const detail = text.slice(text.indexOf("\n") + 1);
    expect(detail).toMatch(/The LayerZero reporter cannot pay its bridge fee/);
    expect(detail).toMatch(/choose oracles without LayerZero/);
  });
  it("no first paragraph names a contract, a role or says nothing was charged", () => {
    const cases: [string, unknown[]][] = [
      ["InsufficientPayment", []],
      ["InvalidThreshold", []],
      ["OracleNotEnabled", [3n]],
      ["DuplicateOracle", [1n]],
      ["InsufficientFunds", [1n, 0n]],
      ["ReporterCannotPay", ["Vea", 1n, 0n]],
      ["TokenNotAccepted", []],
      ["ERC20InsufficientAllowance", [A(1), 0n, 1n]],
      ["ERC20InsufficientBalance", [A(1), 0n, 1n]],
      ["TransferFailed", []],
      ["UnexpectedAdapters", []],
      ["GovernorOnly", []],
    ];
    for (const [name, args] of cases) {
      let text: string;
      try {
        text = describeError(revert(name, args));
      } catch {
        continue; // error not in the ABI under this signature
      }
      expect(first(text), name).not.toMatch(/Nothing was char[g]ed|HomeGateway|ForeignGateway|Lightbulb|Yaru|Yaho|reporter|keeper|Kleros ops/i);
      expect(text, name).not.toMatch(/Nothing was char[g]ed/);
    }
  });
  it("describeRevert stays neutral about the situation; the prefixes belong to the caller", () => {
    const text = describeError(revert("InsufficientFunds", [1n, 0n]));
    expect(text).not.toMatch(/Cancelled before sending|gas may have been used/);
    const sent = withLead(CANCELLED_BEFORE_SENDING, text);
    expect(first(sent)).toMatch(/^Cancelled before sending\. The court side/);
    expect(MINED_REVERT).toMatch(/gas may have been used/);
  });
  it("finds the revert in raw data deep in a cause chain", () => {
    const data = encodeErrorResult({ abi: allErrorsAbi, errorName: "InsufficientPayment" });
    const nested = new Error("outer", { cause: new Error("rpc", { cause: { data } }) });
    expect(findRevert(nested)?.errorName).toBe("InsufficientPayment");
  });
  it("OracleNotEnabled uses the oracle name when known", () => {
    expect(describeError(revert("OracleNotEnabled", [3n]), { oracleName: () => "deBridge" })).toMatch(/^deBridge is not available/);
  });
  it("a wallet rejection", () => {
    expect(describeError(new UserRejectedRequestError(new Error("no")))).toMatch(/rejected the request in your wallet/);
  });
  it("an unknown custom error still names it", () => {
    expect(describeError(revert("GovernorOnly"))).toMatch(/reverted with GovernorOnly/);
  });
  it("toSwitchError keeps the original as cause", () => {
    const original = revert("InsufficientPayment");
    const error = toSwitchError(original);
    expect(error.message).toMatch(/less than the cost/);
    expect(error.cause).toBe(original);
  });
});

describe("pre-send and mined failures keep one honest lead", () => {
  it("requestSwitch and approveUsdc with no connected account lead with Cancelled before sending", async () => {
    const env = { ...sampleEnv(), foreign: { ...sampleEnv().foreign, rpcUrl: "http://127.0.0.1:1" }, home: { ...sampleEnv().home, rpcUrl: "http://127.0.0.1:2" } };
    const data = createSwitchData(env, createWagmiConfig(env));
    const sel = null as never;
    for (const run of [() => data.requestSwitch(sel, "native"), () => data.approveUsdc(1n)]) {
      const error = await run().then(() => null, (e: Error) => e);
      expect(first(error!.message)).toBe("Cancelled before sending. Connect a wallet first.");
    }
  }, 30000);
  it("withLead never doubles a lead nor hides a mined revert", () => {
    const cancelled = `${CANCELLED_BEFORE_SENDING} Choose at least one oracle.`;
    expect(withLead(CANCELLED_BEFORE_SENDING, cancelled)).toBe(cancelled);
    const mined = `${MINED_REVERT}\nThe USDC approval transaction 0x1 reverted.`;
    expect(withLead(CANCELLED_BEFORE_SENDING, mined)).toBe(mined);
    expect(first(withLead(CANCELLED_BEFORE_SENDING, mined))).toMatch(/^Transaction failed/);
  });
});

describe("runRule (devnet.rule's logic with fakes)", () => {
  const ok = { homeDisputeId: 0n, ruling: 0 };
  const deps = (over: Partial<RuleDeps> = {}): RuleDeps => ({
    request: async () => ok,
    simulate: async () => undefined,
    write: async () => "0xabc" as never,
    waitForReceipt: async () => ({ status: "success" }),
    fail: async (error, before) => {
      throw toFailure(error, before ?? false, {});
    },
    ...over,
  });
  const run = (d: RuleDeps) => runRule(d, 7n, 1).then(() => "", (e: Error) => e.message);

  it("pre-send cases lead with Cancelled before sending.", async () => {
    expect(first(await run(deps({ request: async () => null })))).toMatch(/^Cancelled before sending\. Dispute #7 does not exist/);
    expect(first(await run(deps({ request: async () => ({ homeDisputeId: null, ruling: 0 }) })))).toMatch(
      /^Cancelled before sending\. The dispute has not reached/,
    );
    expect(first(await run(deps({ request: async () => ({ homeDisputeId: 0n, ruling: 1 }) })))).toMatch(
      /^Cancelled before sending\. This dispute already has a ruling/,
    );
    const text = await run(deps({ simulate: async () => Promise.reject(revert("InsufficientPayment")) }));
    expect(text.startsWith(CANCELLED_BEFORE_SENDING)).toBe(true);
  });
  it("a mined revert uses MINED_REVERT", async () => {
    const text = await run(deps({ waitForReceipt: async () => ({ status: "reverted" }) }));
    expect(first(text)).toBe(MINED_REVERT);
    expect(text).toContain("0xabc");
  });
  it("a failure after sending is not labelled as cancelled", async () => {
    const text = await run(deps({ waitForReceipt: async () => Promise.reject(new Error("rpc down")) }));
    expect(text.startsWith(CANCELLED_BEFORE_SENDING)).toBe(false);
  });
});
