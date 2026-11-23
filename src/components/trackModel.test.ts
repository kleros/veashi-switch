import { describe, expect, it } from "vitest";
import type { Address, ChainInfo, ChainKey, Hex, Oracle } from "../data";
import { buildRequest, type LegFacts, type RequestFacts } from "../data/lifecycle";
import { logEntries, messageLinks, scannerLink } from "./trackModel";

const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const OWNER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const names = { foreign: "Base Sepolia", home: "Arbitrum Sepolia", testnet: true };
const oracles: Oracle[] = ["Vea", "CCIP", "LayerZero"].map((name, id) => ({
  id,
  name,
  via: `${name}Reporter · ${name}Adapter`,
  enabled: true,
  bridgingCostWei: 1n,
}));

// Transactions by role: the request (dispute leg's source), the ruling's dispatch and the creation failure (return leg's).
const REQUEST_TX = h(1);
const RULING_TX = h(20);
const FAILURE_TX = h(40);

const leg = (dispatchTx: Hex, reported: number[], extra: Partial<LegFacts> = {}): LegFacts => ({
  messageId: 7n,
  dispatchTx,
  reports: [0, 1, 2].map((oracleId) => ({ oracleId, txHash: reported.includes(oracleId) ? h(100 + oracleId) : null })),
  executedTx: null,
  failure: null,
  executable: false,
  ...extra,
});

const base = (over: Partial<RequestFacts> = {}): RequestFacts => ({
  disputeId: 1n,
  owner: OWNER,
  selection: { oracleIds: [0, 1, 2], threshold: 2 },
  paid: { token: "native", amount: 5n },
  requestTx: REQUEST_TX,
  requestedAt: 1000,
  dispute: null,
  delivered: null,
  created: null,
  creationBlocker: null,
  creationFailure: null,
  ruling: null,
  rulingLeg: null,
  switched: null,
  closed: null,
  refund: null,
  refundPending: false,
  homeTime: 1500,
  updatedAt: 2000,
  ...over,
});

const relaying = () => base({ dispute: leg(REQUEST_TX, [1]) });
const delivered = (over: Partial<RequestFacts> = {}) =>
  base({ dispute: leg(REQUEST_TX, [0, 1], { executedTx: h(10) }), delivered: { at: 1200, failableAt: 1800 }, ...over });
const ruled = () => delivered({ created: { tx: h(11), homeDisputeId: 0n }, ruling: { value: 1n, tx: RULING_TX } });
const rulingRelaying = () => ({ ...ruled(), rulingLeg: leg(RULING_TX, [0], { messageId: 8n }) });
const switched = () => ({
  ...ruled(),
  rulingLeg: leg(RULING_TX, [0, 1, 2], { messageId: 8n, executedTx: h(30) }),
  switched: { tx: h(31) },
});
const creationFailed = () => delivered({ homeTime: 1900, creationFailure: { tx: FAILURE_TX } });
const closed = () => ({
  ...creationFailed(),
  rulingLeg: leg(FAILURE_TX, [0, 1, 2], { messageId: 9n, executedTx: h(50) }),
  closed: { tx: h(51) },
  refund: { token: "native" as const, amount: 3n, claimed: null },
  refundPending: true,
});

/** The steps that carry a leg's message, with the source transaction each would link to. */
const sources = (facts: RequestFacts) =>
  Object.fromEntries(
    logEntries(buildRequest(facts), oracles, names)
      .filter((e) => e.source)
      .map((e) => [e.key, { leg: e.source!.leg, chain: e.source!.tx.chain, hash: e.source!.tx.hash }]),
  );

const SCANNER = "https://veashi-scanner.vercel.app";
const chain = (id: number): Pick<ChainInfo, "scannerTxUrl"> => ({ scannerTxUrl: (hash) => `${SCANNER}/tx/${id}/${hash}` });
const testnet: Record<ChainKey, Pick<ChainInfo, "scannerTxUrl">> = { foreign: chain(84532), home: chain(421614) };
const devnet: Record<ChainKey, Pick<ChainInfo, "scannerTxUrl">> = { foreign: { scannerTxUrl: null }, home: { scannerTxUrl: null } };

describe("which steps link to Veashi Scanner", () => {
  it("the request's delivery step links the dispute leg by the request transaction, on the foreign chain", () => {
    expect(sources(relaying())).toEqual({ "dispute-relaying": { leg: "dispute", chain: "foreign", hash: REQUEST_TX } });
    // before any oracle reported: the request transaction dispatched the message
    expect(sources(base({ dispute: leg(REQUEST_TX, []) }))).toEqual({
      "dispute-relaying": { leg: "dispute", chain: "foreign", hash: REQUEST_TX },
    });
  });
  it("no link while the request transaction dispatched no message (still at submitted)", () => {
    expect(buildRequest(base()).stage).toBe("submitted");
    expect(sources(base())).toEqual({});
  });
  it("the return step has no link until the home chain dispatched something back", () => {
    for (const facts of [delivered(), delivered({ created: { tx: h(11), homeDisputeId: 0n } })]) {
      expect(Object.keys(sources(facts))).toEqual(["dispute-relaying"]);
    }
  });
  it("the decision's return step links the ruling's dispatch on the home chain, from the decision to the end", () => {
    for (const facts of [ruled(), rulingRelaying(), switched()]) {
      expect(sources(facts)).toEqual({
        "dispute-relaying": { leg: "dispute", chain: "foreign", hash: REQUEST_TX },
        "ruling-relaying": { leg: "ruling", chain: "home", hash: RULING_TX },
      });
    }
  });
  it("on the failure path, the failure's return step links sendCreationFailure on the home chain", () => {
    for (const facts of [creationFailed(), closed()]) {
      expect(sources(facts)).toEqual({
        "dispute-relaying": { leg: "dispute", chain: "foreign", hash: REQUEST_TX },
        "failure-relaying": { leg: "failure", chain: "home", hash: FAILURE_TX },
      });
    }
  });
  it("each link's source is the transaction the data layer read the leg's message from (its dispatchTx)", () => {
    for (const facts of [switched(), closed()]) {
      const linked = sources(facts);
      expect(linked["dispute-relaying"].hash).toBe(facts.dispute!.dispatchTx);
      expect((linked["ruling-relaying"] ?? linked["failure-relaying"]).hash).toBe(facts.rulingLeg!.dispatchTx);
    }
  });
  it("a paused leg keeps its link", () => {
    const paused = buildRequest(base({ dispute: leg(REQUEST_TX, [0, 1], { failure: "Paused." }) }));
    expect(paused.stage).toBe("failed");
    const entry = logEntries(paused, oracles, names).find((e) => e.key === "dispute-relaying")!;
    expect(entry.state).toBe("fail");
    expect(scannerLink(entry, testnet)?.href).toBe(`${SCANNER}/tx/84532/${REQUEST_TX}`);
  });
});

describe("scannerLink", () => {
  const entries = logEntries(buildRequest(closed()), oracles, names);
  const byKey = (key: string) => entries.find((e) => e.key === key)!;

  it("builds the scanner URL from the source chain and transaction, and names the leg", () => {
    expect(scannerLink(byKey("dispute-relaying"), testnet)).toEqual({
      href: `${SCANNER}/tx/84532/${REQUEST_TX}`,
      label: "View in Veashi Scanner: the request, Base Sepolia to Arbitrum Sepolia (opens in a new tab)",
    });
    expect(scannerLink(byKey("failure-relaying"), testnet)).toEqual({
      href: `${SCANNER}/tx/421614/${FAILURE_TX}`,
      label: "View in Veashi Scanner: the creation failure, Arbitrum Sepolia to Base Sepolia (opens in a new tab)",
    });
    const ruling = logEntries(buildRequest(switched()), oracles, names).find((e) => e.key === "ruling-relaying")!;
    expect(scannerLink(ruling, testnet)).toEqual({
      href: `${SCANNER}/tx/421614/${RULING_TX}`,
      label: "View in Veashi Scanner: the decision, Arbitrum Sepolia to Base Sepolia (opens in a new tab)",
    });
  });
  it("gives no link on the steps without a leg", () => {
    for (const e of entries.filter((x) => !["dispute-relaying", "failure-relaying"].includes(x.key))) {
      expect(scannerLink(e, testnet)).toBeNull();
    }
  });
  it("gives no link without a scanner (the devnet)", () => {
    for (const e of entries) expect(scannerLink(e, devnet)).toBeNull();
  });
});

describe("messageLinks (the request summary's links, in both views)", () => {
  const links = (facts: RequestFacts, chains = testnet) => messageLinks(logEntries(buildRequest(facts), oracles, names), chains);

  it("lists each known leg once, in step order, with its direction in the visible text", () => {
    expect(links(closed())).toEqual([
      {
        key: "dispute-relaying",
        href: `${SCANNER}/tx/84532/${REQUEST_TX}`,
        text: "The request, Base Sepolia to Arbitrum Sepolia",
        label: "The request, Base Sepolia to Arbitrum Sepolia, in Veashi Scanner (opens in a new tab)",
      },
      {
        key: "failure-relaying",
        href: `${SCANNER}/tx/421614/${FAILURE_TX}`,
        text: "The creation failure, Arbitrum Sepolia to Base Sepolia",
        label: "The creation failure, Arbitrum Sepolia to Base Sepolia, in Veashi Scanner (opens in a new tab)",
      },
    ]);
    expect(links(switched()).map((l) => [l.key, l.href, l.text])).toEqual([
      ["dispute-relaying", `${SCANNER}/tx/84532/${REQUEST_TX}`, "The request, Base Sepolia to Arbitrum Sepolia"],
      ["ruling-relaying", `${SCANNER}/tx/421614/${RULING_TX}`, "The decision, Arbitrum Sepolia to Base Sepolia"],
    ]);
  });
  it("the accessible name starts with the visible text", () => {
    for (const l of [...links(closed()), ...links(switched())]) expect(l.label.startsWith(l.text)).toBe(true);
  });
  it("is empty before any message was dispatched, and always without a scanner (the devnet)", () => {
    expect(links(base())).toEqual([]);
    for (const facts of [relaying(), switched(), closed()]) expect(links(facts, devnet)).toEqual([]);
  });
});
