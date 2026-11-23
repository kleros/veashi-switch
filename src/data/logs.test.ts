import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { getContractEventsPaged, isRangeLimitError, statedSpan } from "./logs";

const abi = [{ type: "event", name: "Ping", inputs: [] }] as const;
const address = "0x0000000000000000000000000000000000000001";

interface Call {
  fromBlock: bigint;
  toBlock: bigint;
}

/** A fake client whose "RPC" refuses spans wider than maxSpan and returns one log per block in the range. */
function fakeClient(maxSpan: bigint, failWith: () => Error = () => new Error("block range too large"), head = { block: 100n }) {
  const calls: Call[] = [];
  const heads: { cacheTime?: number }[] = [];
  const client = {
    getBlockNumber: async (args: { cacheTime?: number } = {}) => {
      heads.push(args);
      return head.block;
    },
    getContractEvents: async (p: Call) => {
      calls.push({ fromBlock: p.fromBlock, toBlock: p.toBlock });
      if (p.toBlock - p.fromBlock + 1n > maxSpan) throw failWith();
      return Array.from({ length: Number(p.toBlock - p.fromBlock + 1n) }, (_, i) => ({ blockNumber: p.fromBlock + BigInt(i) }));
    },
  };
  return { client: client as unknown as PublicClient, calls, heads };
}

const blocks = (logs: readonly unknown[]) => (logs as { blockNumber: bigint }[]).map((l) => Number(l.blockNumber));
const seq = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("getContractEventsPaged", () => {
  it("reads the whole range in one call when the RPC allows it", async () => {
    const { client, calls } = fakeClient(1000n);
    const logs = await getContractEventsPaged(client, { abi, address }, { fromBlock: 10n, toBlock: 40n });
    expect(calls).toEqual([{ fromBlock: 10n, toBlock: 40n }]);
    expect(blocks(logs)).toEqual(seq(10, 40));
  });
  it("uses the latest block when toBlock is omitted, read without viem's block-number cache", async () => {
    const { client, calls, heads } = fakeClient(1000n);
    await getContractEventsPaged(client, { abi, address }, { fromBlock: 0n });
    expect(calls[0]).toEqual({ fromBlock: 0n, toBlock: 100n });
    // a read right after a receipt must reach that receipt's block
    expect(heads).toEqual([{ cacheTime: 0 }]);
  });
  it("splits when the RPC refuses the span and merges the logs in block order", async () => {
    const { client, calls } = fakeClient(10n);
    const logs = await getContractEventsPaged(client, { abi, address }, { fromBlock: 1n, toBlock: 50n });
    expect(blocks(logs)).toEqual(seq(1, 50));
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every((c) => c.toBlock - c.fromBlock + 1n <= 25n || c === calls[0])).toBe(true);
  });
  it("rethrows errors that are not range limits", async () => {
    const { client } = fakeClient(0n, () => new Error("execution reverted"));
    await expect(getContractEventsPaged(client, { abi, address }, { fromBlock: 1n, toBlock: 50n })).rejects.toThrow(
      /execution reverted/,
    );
  });
  it("rethrows a limit error on a single block", async () => {
    const { client, calls } = fakeClient(0n);
    await expect(getContractEventsPaged(client, { abi, address }, { fromBlock: 7n, toBlock: 7n })).rejects.toThrow(
      /block range/,
    );
    expect(calls).toHaveLength(1);
  });
  it("starts later calls with chunks of the span that worked", async () => {
    const { client, calls } = fakeClient(10n);
    await getContractEventsPaged(client, { abi, address }, { fromBlock: 1n, toBlock: 40n });
    calls.length = 0;
    const logs = await getContractEventsPaged(client, { abi, address }, { fromBlock: 1n, toBlock: 40n });
    expect(blocks(logs)).toEqual(seq(1, 40));
    expect(calls.every((c) => c.toBlock - c.fromBlock + 1n <= 10n)).toBe(true);
    expect(calls).toHaveLength(4);
  });
  it("keeps reading whole ranges from an RPC that has refused nothing, however small the first range was", async () => {
    const { client, calls } = fakeClient(1_000_000n);
    await getContractEventsPaged(client, { abi, address }, { fromBlock: 1n, toBlock: 5n });
    calls.length = 0;
    await getContractEventsPaged(client, { abi, address }, { fromBlock: 1n, toBlock: 5_000n });
    expect(calls).toEqual([{ fromBlock: 1n, toBlock: 5_000n }]);
  });
});

describe("getContractEventsPaged: stated limits and the per-query cache", () => {
  // The wordings measured on Base Sepolia RPCs (2026-11-11): sepolia.base.org, publicnode, drpc's free plan.
  const WORDINGS: [string, bigint][] = [
    ["eth_getLogs is limited to a 200 range", 200n],
    ["exceed maximum block range: 50000", 50_000n],
    ["ranges over 10000 blocks are not supported on free plan", 10_000n],
  ];
  it("reads in chunks of the span the error states, after one refusal", async () => {
    const { client, calls } = fakeClient(200n, () => new Error(WORDINGS[0][0]));
    const logs = await getContractEventsPaged(client, { abi, address }, { fromBlock: 1n, toBlock: 1000n });
    expect(blocks(logs)).toEqual(seq(1, 1000));
    expect(calls).toHaveLength(6); // the refused whole range, then five chunks of 200
    expect(calls.slice(1).every((c) => c.toBlock - c.fromBlock + 1n === 200n)).toBe(true);
  });
  it("recognises the measured wordings and the span each states", () => {
    for (const [message, span] of WORDINGS) {
      expect(isRangeLimitError(new Error(message)), message).toBe(true);
      expect(statedSpan(new Error(message)), message).toBe(span);
    }
    expect(statedSpan(new Error("query returned more than 10000 results"))).toBeNull();
    expect(statedSpan(new Error("returned up to 10000 results"))).toBeNull();
  });
  it("polls the same query by reading only the blocks since the last read, less a reorg margin", async () => {
    const head = { block: 100n };
    const { client, calls } = fakeClient(1_000_000n, undefined, head);
    expect(blocks(await getContractEventsPaged(client, { abi, address }, { fromBlock: 1n }))).toEqual(seq(1, 100));
    head.block = 150n;
    calls.length = 0;
    expect(blocks(await getContractEventsPaged(client, { abi, address }, { fromBlock: 1n }))).toEqual(seq(1, 150));
    expect(calls).toEqual([{ fromBlock: 69n, toBlock: 150n }]); // 100 - 32 + 1
  });
  it("reads afresh when the head went back (a restarted devnet) or the start block differs", async () => {
    const head = { block: 100n };
    const { client, calls } = fakeClient(1_000_000n, undefined, head);
    await getContractEventsPaged(client, { abi, address }, { fromBlock: 1n });
    head.block = 40n;
    calls.length = 0;
    expect(blocks(await getContractEventsPaged(client, { abi, address }, { fromBlock: 1n }))).toEqual(seq(1, 40));
    expect(calls).toEqual([{ fromBlock: 1n, toBlock: 40n }]);
    calls.length = 0;
    await getContractEventsPaged(client, { abi, address }, { fromBlock: 10n });
    expect(calls).toEqual([{ fromBlock: 10n, toBlock: 40n }]);
  });
  it("keeps queries with different filters apart", async () => {
    const { client, calls } = fakeClient(1_000_000n);
    await getContractEventsPaged(client, { abi, address, args: {} as never }, { fromBlock: 1n });
    await getContractEventsPaged(client, { abi, address: "0x0000000000000000000000000000000000000002" }, { fromBlock: 1n });
    expect(calls).toEqual([
      { fromBlock: 1n, toBlock: 100n },
      { fromBlock: 1n, toBlock: 100n },
    ]);
  });
});

describe("isRangeLimitError", () => {
  it("recognises the usual provider wordings, codes and statuses", () => {
    for (const message of [
      "eth_getLogs is limited to a 10,000 range",
      "Log response size exceeded",
      "query returned more than 10000 results",
      "block range is too large",
      "Too many logs",
    ]) {
      expect(isRangeLimitError(new Error(message))).toBe(true);
    }
    expect(isRangeLimitError({ code: -32005 })).toBe(true);
    expect(isRangeLimitError({ code: -32602 })).toBe(true);
    expect(isRangeLimitError({ code: -32614 })).toBe(true);
    expect(isRangeLimitError({ status: 413 })).toBe(true);
    expect(isRangeLimitError({ message: "wrapper", cause: { code: -32005 } })).toBe(true);
  });
  it("does not treat other failures as range limits", () => {
    expect(isRangeLimitError(new Error("execution reverted"))).toBe(false);
    expect(isRangeLimitError(new Error("429 rate limit exceeded"))).toBe(false);
    expect(isRangeLimitError(null)).toBe(false);
  });
});
