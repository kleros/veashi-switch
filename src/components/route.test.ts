import { describe, expect, it } from "vitest";
import type { ChainInfo, CostQuote, SwitchRequest } from "../data";
import { costBreakdown, displayedSum } from "./costModel";
import { formatAmount, formatAmounts } from "./format";
import { listState, quoteMatches, routeConfig, walletGate } from "./route";

const info = (key: "foreign" | "home", id: number, name: string): ChainInfo => ({
  key,
  id,
  name,
  rpcUrl: "http://127.0.0.1:8645",
  explorerTxUrl: null,
});
const route = routeConfig({ foreign: info("foreign", 31337001, "Base-like"), home: info("home", 31337002, "Arbitrum-like") });

describe("route", () => {
  it("derives the pill and the labels from the one route configuration", () => {
    expect(route.pill).toBe("Local · Base-like → Arbitrum-like");
    expect(route.fromLabel).toBe("Base-like local devnet");
    expect(route.toLabel).toBe("Arbitrum-like local devnet");
  });
});

describe("walletGate", () => {
  const gate = (status: "disconnected" | "connecting" | "connected" | "wrong-chain", chainId: number | null, networkUp = true) =>
    walletGate({ networkUp, status, chainId, route });
  it("disconnected: route and fees stay readable, nothing can be sent", () => {
    const g = gate("disconnected", null);
    expect(g.state).toBe("disconnected");
    expect(g.canTransact).toBe(false);
  });
  it("correct chain: ready, named for the route", () => {
    const g = gate("connected", 31337001);
    expect(g).toMatchObject({ state: "ready", canTransact: true, message: "Wallet on Base-like local devnet" });
  });
  it("wrong chain, an Arbitrum-like wallet included: blocked with the switch message", () => {
    for (const id of [31337002, 1]) {
      const g = gate("wrong-chain", id);
      expect(g.state).toBe("wrong-chain");
      expect(g.canTransact).toBe(false);
      expect(g.message).toBe("Your wallet is on a different network. Switch to Base-like local devnet to send.");
    }
    expect(gate("wrong-chain", 31337002)).toMatchObject({ onHomeChain: true });
  });
  it("unavailable network wins over any wallet state", () => {
    for (const s of ["disconnected", "connected", "wrong-chain"] as const) {
      const g = gate(s, 31337001, false);
      expect(g.state).toBe("unavailable");
      expect(g.message).toBe("Local network unavailable");
      expect(g.canTransact).toBe(false);
    }
  });
});

const quote = (over: Partial<CostQuote> = {}): CostQuote => ({
  selection: null,
  token: "native",
  jurorFees: 2_700_000_000_000_000n,
  bridging: [
    { oracleId: 0, amount: 420_000_000_000_000n },
    { oracleId: 1, amount: 1_180_000_000_000_000n },
  ],
  total: 4_300_000_000_000_000n,
  decimals: 18,
  symbol: "ETH",
  ...over,
});

describe("quoteMatches (the staleness predicate)", () => {
  const sel = { oracleIds: [0, 1], threshold: 2 };
  it("accepts a quote for exactly the configuration on screen", () => {
    expect(quoteMatches(quote(), { selection: null, token: "native" })).toBe(true);
    expect(quoteMatches(quote({ selection: sel }), { selection: { ...sel }, token: "native" })).toBe(true);
  });
  it("is stale after a token, oracle or threshold change, and when there is no quote", () => {
    expect(quoteMatches(quote(), { selection: null, token: "usdc" })).toBe(false);
    expect(quoteMatches(quote(), { selection: sel, token: "native" })).toBe(false);
    expect(quoteMatches(quote({ selection: sel }), { selection: null, token: "native" })).toBe(false);
    expect(quoteMatches(quote({ selection: sel }), { selection: { oracleIds: [0, 1, 2], threshold: 2 }, token: "native" })).toBe(false);
    expect(quoteMatches(quote({ selection: sel }), { selection: { oracleIds: [0, 1], threshold: 1 }, token: "native" })).toBe(false);
    expect(quoteMatches(null, { selection: null, token: "native" })).toBe(false);
  });
});

describe("cost breakdown", () => {
  it("shows rows that sum exactly to the total, in ETH", () => {
    const b = costBreakdown(quote(), (id) => `Oracle ${id}`);
    expect(displayedSum(b.lines, 18)).toBe(4_300_000_000_000_000n);
    expect(b.total).toBe("0.00430 ETH");
    expect(b.lines.map((l) => l.text)).toEqual(["0.0027", "0.00042", "0.00118"].map((t) => t.padEnd(7, "0")));
  });
  it("shows rows that sum exactly to the total, in USDC, with no ETH anywhere", () => {
    const q = quote({
      token: "usdc",
      symbol: "USDC",
      decimals: 6,
      jurorFees: 6_615_000n,
      bridging: [
        { oracleId: 0, amount: 1_029_000n },
        { oracleId: 1, amount: 2_891_000n },
        { oracleId: 2, amount: 2_100_500n },
      ],
      total: 12_635_500n,
    });
    const b = costBreakdown(q, (id) => `Oracle ${id}`);
    expect(displayedSum(b.lines, 6)).toBe(q.total);
    expect(b.total).toBe("12.6355 USDC");
    expect(JSON.stringify(b)).not.toMatch(/ETH/);
  });
  it("makes a difference between the parts and the total its own row instead of hiding it", () => {
    const b = costBreakdown(quote({ total: 4_350_000_000_000_000n }), (id) => `Oracle ${id}`);
    expect(b.lines.at(-1)?.label).toBe("Other fees");
    expect(displayedSum(b.lines, 18)).toBe(4_350_000_000_000_000n);
  });
  it("formats amounts with at least two decimals and never rounds", () => {
    expect(formatAmount(1_500_000n, 6, "USDC")).toBe("1.50 USDC");
    expect(formatAmounts([1n, 2_500_000_000_000_000_000n], 18)[1]).toBe("2.500000000000000000");
    expect(formatAmount(0n, 18)).toBe("0.00");
  });
});

describe("listState", () => {
  const item = {} as SwitchRequest;
  it("tells loading, failed, empty and ready apart", () => {
    expect(listState({ loading: true, error: null, items: null })).toBe("loading");
    expect(listState({ loading: false, error: null, items: null })).toBe("loading");
    expect(listState({ loading: false, error: "Could not read", items: null })).toBe("failed");
    expect(listState({ loading: false, error: "Could not read", items: [item] })).toBe("failed");
    expect(listState({ loading: false, error: null, items: [] })).toBe("empty");
    expect(listState({ loading: false, error: null, items: [item] })).toBe("ready");
  });
});
