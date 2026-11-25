import { describe, expect, it } from "vitest";
import type { Address, ChainInfo, ChainKey, Hex, Oracle, RequestStage, SwitchRequest } from "../data";
import { buildRequest, type LegFacts, type RequestFacts } from "../data/lifecycle";
import { NODE_TITLES, REFUSED_NODE_TITLES, requestModel } from "./circuitModel";
import { decisionOf } from "./format";
import type { BulbRead } from "./readState";
import {
  actionModels,
  bulbPhase,
  bulbReadKey,
  JUROR_CHECKING,
  JUROR_UNREAD,
  jurorLine,
  logEntries,
  messageLinks,
  nowModel,
  scannerLink,
  txName,
} from "./trackModel";

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
  lightbulb: "0x9b2F1d258F7ded62874807c6DD15247b5C6Cff37",
  jurorGuide: true,
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

// The court stages of a request: the case is open (214, as on the testnet), then a ruling of `value` is given and returns.
const inCourt = (over: Partial<RequestFacts> = {}) => delivered({ created: { tx: h(11), homeDisputeId: 214n }, ...over });
const decided = (value: bigint) => delivered({ created: { tx: h(11), homeDisputeId: 214n }, ruling: { value, tx: RULING_TX } });
const returning = (value: bigint, over: Partial<LegFacts> = {}) => ({ ...decided(value), rulingLeg: leg(RULING_TX, [0], { messageId: 8n, ...over }) });
const applied = (value: bigint) => ({
  ...decided(value),
  rulingLeg: leg(RULING_TX, [0, 1, 2], { messageId: 8n, executedTx: h(30) }),
  switched: { tx: h(31) },
});
const OFF: BulbRead = { kind: "known", on: false };
const ON: BulbRead = { kind: "known", on: true };
const now = (r: SwitchRequest, bulb?: BulbRead, more: { canSimulate?: boolean; mine?: boolean } = {}) =>
  nowModel(r, oracles, names, { canSimulate: false, bulb, ...more });
/** Every string the default view can show for a request: status card, steps, step buttons and circuit. */
const shown = (r: SwitchRequest, bulb: BulbRead = OFF) => {
  const n = now(r, bulb);
  const c = requestModel(r, oracles, names, bulb);
  return [
    ...r.txs.map((t) => txName(t)),
    n.title,
    n.body,
    n.statusText,
    n.next,
    n.bulbNow?.value ?? "",
    n.bulbNow?.differs ?? "",
    n.bulbNow?.juror ?? "",
    ...logEntries(r, oracles, names).map((e) => e.title),
    ...actionModels(r, names, { selfServe: true }).flatMap((a) => [a.label, a.note]),
    ...c.bulbLabel,
    ...Object.values(c.sub),
    ...Object.values(c.titles),
  ].join("\n");
};

describe("the requester's bulb during the court stages, for jurors", () => {
  it("reads the bulb from the court case until the decision is applied, and once the request is final", () => {
    const phases = Object.fromEntries(
      (["submitted", "dispute-relaying", "dispute-delivered", "dispute-received", "ruled", "ruling-relaying", "switched", "creation-failed", "failure-relaying", "closed", "failed"] as RequestStage[]).map((s) => [s, bulbPhase(s)]),
    );
    expect(phases).toEqual({
      submitted: null,
      "dispute-relaying": null,
      "dispute-delivered": null,
      "dispute-received": "court",
      ruled: "court",
      "ruling-relaying": "court",
      switched: "final",
      "creation-failed": null,
      "failure-relaying": null,
      closed: "final",
      failed: null,
    });
    expect(bulbPhase(undefined)).toBeNull();
  });

  it("reads again at each court stage and refresh, not at each poll; once final, at each update", () => {
    const r = buildRequest(inCourt());
    expect(bulbReadKey(r, 0)).toBe("court:dispute-received:0");
    // a poll of the same request (only updatedAt moves) keeps the read; a refresh tick or a new stage starts one
    expect(bulbReadKey({ ...r, updatedAt: r.updatedAt + 5000 }, 0)).toBe(bulbReadKey(r, 0));
    expect(bulbReadKey(r, 1)).not.toBe(bulbReadKey(r, 0));
    expect(bulbReadKey(buildRequest(decided(1n)), 0)).toBe("court:ruled:0");
    const done = buildRequest(applied(1n));
    expect(bulbReadKey(done, 0)).toBe(`final:${done.updatedAt}`);
    expect(bulbReadKey(done, 3)).toBe(bulbReadKey(done, 0)); // no refresh once final
    expect(bulbReadKey({ ...done, updatedAt: done.updatedAt + 1 }, 0)).not.toBe(bulbReadKey(done, 0));
    for (const facts of [base(), delivered()]) expect(bulbReadKey(buildRequest(facts), 0)).toBeNull();
    expect(bulbReadKey(undefined, 0)).toBeNull();
    expect(bulbReadKey(null, 0)).toBeNull();
  });

  it("while the court decides: bulb Off means Switch it on, bulb On means Switch it off, with or without a wallet", () => {
    const r = buildRequest(inCourt());
    expect(r.stage).toBe("dispute-received");
    expect(now(r, OFF).bulbNow).toEqual({
      label: "Requester's bulb now",
      value: "Off",
      differs: null,
      retry: false,
      juror: "The bulb is off now, so the answer that flips it is “Switch it on”.",
    });
    expect(now(r, ON).bulbNow).toMatchObject({
      value: "On",
      juror: "The bulb is on now, so the answer that flips it is “Switch it off”.",
    });
    // the local demo has no jurors: you decide On or Off, so the bulb shows without a juror line
    for (const bulb of [OFF, ON, { kind: "loading" } as const, { kind: "failed" } as const])
      expect(now(r, bulb, { canSimulate: true }).bulbNow).toMatchObject({ juror: null });
    expect(now(r, ON, { canSimulate: true }).bulbNow).toMatchObject({ value: "On" });
    expect(jurorLine(false)).toMatch(/“Switch it on”/);
    expect(jurorLine(true)).toMatch(/“Switch it off”/);
    expect(now(r, OFF, { mine: true }).bulbNow?.label).toBe("Your bulb now");
    // a juror is not the requester: the headline does not say "Your request"
    expect(now(r, OFF).title).toBe("The request is in court · Court case #214");
    expect(now(r, OFF, { mine: true }).title).toBe("Your request is in court · Court case #214");
  });

  it("has no jurors' line for a request on a lightbulb whose court template it does not follow (the first testnet one)", () => {
    const r = buildRequest(inCourt({ jurorGuide: false }));
    expect(r.stage).toBe("dispute-received");
    expect(r.jurorGuide).toBe(false);
    for (const bulb of [OFF, ON, { kind: "loading" } as const, { kind: "failed" } as const])
      expect(now(r, bulb).bulbNow).toMatchObject({ juror: null });
    // the requester's bulb itself is still shown
    expect(now(r, ON).bulbNow).toMatchObject({ label: "Requester's bulb now", value: "On" });
  });

  it("names no answer while the bulb is loading or its read failed (with a retry), but keeps the jurors' line", () => {
    const r = buildRequest(inCourt());
    expect(now(r, { kind: "loading" }).bulbNow).toMatchObject({ value: "Checking bulb…", retry: false, juror: JUROR_CHECKING });
    expect(now(r).bulbNow).toMatchObject({ value: "Checking bulb…", juror: JUROR_CHECKING });
    expect(now(r, { kind: "failed" }).bulbNow).toMatchObject({ value: "Current bulb state unavailable", retry: true, juror: JUROR_UNREAD });
    for (const line of [JUROR_CHECKING, JUROR_UNREAD]) expect(line).not.toMatch(/Switch it (on|off)/);
  });

  it("keeps the current bulb, without the juror line, once the decision is given and while it returns", () => {
    for (const facts of [decided(1n), returning(1n), decided(0n), returning(0n)]) {
      const r = buildRequest(facts);
      expect(["ruled", "ruling-relaying"]).toContain(r.stage);
      expect(now(r, OFF).bulbNow).toMatchObject({ value: "Off", juror: null, retry: false });
      expect(now(r, { kind: "failed" }).bulbNow).toMatchObject({ value: "Current bulb state unavailable", retry: true });
    }
  });

  it("shows no bulb line before the case exists or on the failure path before it closes", () => {
    for (const facts of [base(), relaying(), delivered(), creationFailed()]) expect(now(buildRequest(facts), OFF).bulbNow).toBeNull();
  });
});

describe("a decision of 0: the court refused to arbitrate", () => {
  it("tells a refusal from a decision not given yet by the stage, not the ruling code", () => {
    expect(decisionOf(buildRequest(inCourt()))).toBe("pending");
    expect(decisionOf(buildRequest(decided(0n)))).toBe("refused");
    expect(decisionOf(buildRequest(returning(0n)))).toBe("refused");
    expect(decisionOf(buildRequest(applied(0n)))).toBe("refused");
    expect(decisionOf(buildRequest(decided(1n)))).toBe("on");
    expect(decisionOf(buildRequest(applied(2n)))).toBe("off");
    // the failure path has no decision; a paused return leg keeps the one it carries
    expect(decisionOf(buildRequest(closed()))).toBe("pending");
    const paused = buildRequest(returning(0n, { reports: [0, 1, 2].map((oracleId) => ({ oracleId, txHash: h(100 + oracleId) })), failure: "Paused." }));
    expect(paused.stage).toBe("failed");
    expect(decisionOf(paused)).toBe("refused");
  });

  it("says the court refused and the bulb is left unchanged, at every stage after the decision", () => {
    const ruled = buildRequest(decided(0n));
    expect(now(ruled).body).toBe("The court refused to arbitrate, so the bulb is left unchanged. The return delivery starts.");
    expect(logEntries(ruled, oracles, names).find((e) => e.key === "ruled")?.title).toBe("Court refused to arbitrate");
    expect(logEntries(ruled, oracles, names).find((e) => e.key === "switched")?.title).toBe("Request completes · the bulb stays as it is");
    expect(logEntries(ruled, oracles, names).find((e) => e.key === "ruled")?.tech).toMatch(/ruling code 0 \(0 = refused to arbitrate/);
    expect(logEntries(buildRequest(inCourt()), oracles, names).find((e) => e.key === "ruled")?.tech).toMatch(/no ruling yet$/);

    const back = buildRequest(returning(0n));
    expect(now(back).body).toBe(
      "The court refused to arbitrate. Once 2 oracles report the decision on Base Sepolia, the request completes and the bulb is left unchanged.",
    );
    expect(now(back).next).toBe("Oracles: CCIP, LayerZero");
    // once the decision can be delivered or applied, the next step applies it: it updates no bulb
    for (const action of ["deliver-back", "execute-ruling"] as const)
      expect(now({ ...back, actions: [action] }).next).toBe("Applying the decision on Base Sepolia: Anyone, or an automatic relay service");
    expect(requestModel(back, oracles, names).titles).toEqual(REFUSED_NODE_TITLES);
    expect(REFUSED_NODE_TITLES.foreignIn).toBe("Decision applied");
    expect(requestModel(back, oracles, names).bulbLabel).toEqual([
      "Bulb will not change",
      "The court refused to arbitrate; the decision is crossing back to Base Sepolia",
    ]);
    expect(requestModel(back, oracles, names).sub.court).toBe("Refused to arbitrate");

    const executable = { ...back, actions: ["execute-ruling" as const] };
    expect(actionModels(executable, names, { selfServe: true })[0]).toMatchObject({ action: "execute-ruling", label: "Apply the decision" });
    expect(actionModels(executable, names, { selfServe: true })[0].note).toMatch(/refused to arbitrate, so the bulb stays as it is/);

    const done = buildRequest(applied(0n));
    for (const bulb of [OFF, ON]) {
      const n = now(done, bulb);
      expect(n.title).toBe("Request complete · bulb unchanged");
      expect(n.body).toBe("The court refused to arbitrate in Court case #214, so the bulb was left unchanged. The decision reached Base Sepolia.");
      expect(n.statusText).toBe("Decision: Refused to arbitrate");
      // a refusal sets nothing, so the current bulb never "differs" from it
      expect(n.bulbNow).toMatchObject({ value: bulb === ON ? "On" : "Off", differs: null, juror: null });
    }
    expect(logEntries(done, oracles, names).find((e) => e.key === "switched")?.title).toBe("Bulb unchanged · the court refused to arbitrate");
    expect(requestModel(done, oracles, names, ON).bulbLabel).toEqual(["Bulb unchanged: On", "The court refused to arbitrate"]);
  });

  it("never says 'not decided yet', On or Off, or a bulb update for a refusal", () => {
    const refused = [decided(0n), returning(0n), applied(0n)].map((f) => buildRequest(f));
    const back = buildRequest(returning(0n));
    for (const r of [...refused, { ...back, actions: ["deliver-back" as const] }, { ...back, actions: ["execute-ruling" as const] }]) {
      const text = shown(r);
      expect(text).not.toMatch(/not decided yet/i);
      expect(text).not.toMatch(/decided (On|Off)|set (On|Off)|decision, (On|Off)|· (On|Off)$/m);
      expect(text).not.toMatch(/bulb updat/i);
    }
  });

  it("keeps the On and Off wording for rulings 1 and 2", () => {
    expect(logEntries(buildRequest(decided(1n)), oracles, names).find((e) => e.key === "ruled")?.title).toBe("Court decided On");
    expect(now(buildRequest(returning(2n))).body).toBe("The bulb on Base Sepolia is set Off once 2 oracles report the decision.");
    expect(now({ ...buildRequest(returning(1n)), actions: ["execute-ruling"] }).next).toBe(
      "Bulb update on Base Sepolia: Anyone, or an automatic relay service",
    );
    expect(requestModel(buildRequest(returning(1n)), oracles, names).titles).toEqual(NODE_TITLES);
    const off = buildRequest(applied(2n));
    expect(now(off, ON).title).toBe("Request complete · bulb set Off");
    expect(now(off, ON).bulbNow?.differs).toBe("The current state differs from this request's result.");
    expect(logEntries(off, oracles, names).find((e) => e.key === "switched")?.title).toBe("Bulb updated · set Off by this decision");
    expect(requestModel(off, oracles, names, OFF).sub.court).toBe("Court case #214 · Off");
    expect(actionModels({ ...buildRequest(returning(1n)), actions: ["execute-ruling"] }, names, { selfServe: true })[0].label).toBe("Update the bulb");
  });
});
