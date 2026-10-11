import { describe, expect, it } from "vitest";
import { buildRequest, projectTo, stageSteps, STAGES, type LegFacts, type RequestFacts } from "./lifecycle";
import type { Hex } from "./types";

const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const names = (id: number) => ["Vea", "CCIP", "LayerZero", "deBridge"][id];

const leg = (reported: number[], extra: Partial<LegFacts> = {}): LegFacts => ({
  messageId: 7n,
  dispatchTx: h(1),
  reports: [0, 1, 2].map((oracleId) => ({ oracleId, txHash: reported.includes(oracleId) ? h(100 + oracleId) : null })),
  executedTx: null,
  failure: null,
  ...extra,
});

const base = (over: Partial<RequestFacts> = {}): RequestFacts => ({
  disputeId: 4n,
  owner: OWNER,
  selection: { oracleIds: [0, 1, 2], threshold: 2 },
  paid: { token: "native", amount: 5n },
  requestTx: h(1),
  requestedAt: 1000,
  dispute: null,
  homeDisputeId: 0n,
  received: false,
  ruling: null,
  rulingLeg: null,
  switched: null,
  updatedAt: 2000,
  ...over,
});

const relaying = (n: number[]) => base({ dispute: leg(n) });
const received = () => base({ dispute: leg([0, 1], { executedTx: h(10) }), received: true });
const ruled = (value = 1n) => ({ ...received(), ruling: { value, tx: h(20) } });
const rulingRelaying = (n: number[], value = 1n) => ({ ...ruled(value), rulingLeg: leg(n, { dispatchTx: h(20), messageId: 8n }) });
const switched = (value = 1n) => ({
  ...ruled(value),
  rulingLeg: leg([0, 1, 2], { dispatchTx: h(20), messageId: 8n, executedTx: h(30) }),
  switched: { tx: h(30) },
});

describe("buildRequest: each stage", () => {
  it("submitted: the request transaction only", () => {
    const r = buildRequest(base(), names);
    expect(r.stage).toBe("submitted");
    expect(r.txs).toEqual([{ stage: "submitted", chain: "foreign", label: "requestSwitch", hash: h(1) }]);
    expect(r.homeDisputeId).toBeNull();
    expect(r.ruling).toBe(0);
  });
  it("dispute-relaying: per-oracle reports, one storeHash tx each on the home chain", () => {
    const r = buildRequest(relaying([1]), names);
    expect(r.stage).toBe("dispute-relaying");
    expect(r.reports.filter((x) => x.leg === "dispute").map((x) => x.status)).toEqual(["pending", "reported", "pending"]);
    expect(r.reports.filter((x) => x.leg === "ruling").every((x) => x.status === "pending")).toBe(true);
    expect(r.txs[1]).toEqual({ stage: "dispute-relaying", chain: "home", label: "storeHash · CCIP", hash: h(101) });
  });
  it("dispute-received: needs received (never a non-zero id: home dispute 0 exists)", () => {
    const r = buildRequest(received(), names);
    expect(r.stage).toBe("dispute-received");
    expect(r.homeDisputeId).toBe(0n);
    expect(r.txs.at(-1)).toEqual({ stage: "dispute-received", chain: "home", label: "executeMessages", hash: h(10) });
  });
  it("ruled: the executeRuling transaction and the ruling", () => {
    const r = buildRequest(ruled(2n), names);
    expect(r.stage).toBe("ruled");
    expect(r.ruling).toBe(2);
    expect(r.txs.at(-1)).toMatchObject({ stage: "ruled", chain: "home", label: "executeRuling" });
  });
  it("ruling-relaying: ruling-leg reports on the foreign chain", () => {
    const r = buildRequest(rulingRelaying([0]), names);
    expect(r.stage).toBe("ruling-relaying");
    expect(r.reports.filter((x) => x.leg === "ruling").map((x) => x.status)).toEqual(["reported", "pending", "pending"]);
    expect(r.txs.at(-1)).toMatchObject({ stage: "ruling-relaying", chain: "foreign", label: "storeHash · Vea" });
  });
  it("switched: the foreign executeMessages transaction", () => {
    const r = buildRequest(switched(1n), names);
    expect(r.stage).toBe("switched");
    expect(r.ruling).toBe(1);
    expect([...new Set(r.txs.map((t) => t.stage))]).toEqual(STAGES);
    expect(r.error).toBeNull();
  });
});

describe("buildRequest: failures", () => {
  it("a dispute leg whose execution would revert is failed with the reason; unreported oracles are failed", () => {
    const r = buildRequest(base({ dispute: leg([0, 1], { failure: "The HomeGateway ... must fund it" }) }), names);
    expect(r.stage).toBe("failed");
    expect(r.error).toMatch(/must fund it/);
    expect(r.reports.filter((x) => x.leg === "dispute").map((x) => x.status)).toEqual(["reported", "reported", "failed"]);
  });
  it("a ruling leg failure keeps the earlier stages' transactions", () => {
    const facts = rulingRelaying([0, 1]);
    facts.rulingLeg!.failure = "reverted";
    const r = buildRequest(facts, names);
    expect(r.stage).toBe("failed");
    expect(r.ruling).toBe(1);
    expect(r.homeDisputeId).toBe(0n);
    expect(r.txs.map((t) => t.stage)).toContain("ruled");
  });
});

describe("watch ordering", () => {
  it("reports every stage in order even when several happened between two polls", () => {
    const first = buildRequest(base(), names);
    const later = buildRequest(switched(), names);
    const steps = stageSteps(first, later);
    expect(steps.map((s) => s.stage)).toEqual(STAGES.slice(1));
    // Each intermediate snapshot only has what was true at its stage.
    expect(steps[0].txs.every((t) => t.stage === "submitted" || t.stage === "dispute-relaying")).toBe(true);
    expect(steps[0].homeDisputeId).toBeNull();
    expect(steps[2].ruling).toBe(1);
    expect(steps[1].ruling).toBe(0);
  });
  it("reports progress within a stage (another oracle reported) and nothing when unchanged", () => {
    const one = buildRequest(relaying([0]), names);
    const two = buildRequest(relaying([0, 2]), names);
    expect(stageSteps(one, two)).toEqual([two]);
    expect(stageSteps(two, buildRequest(relaying([0, 2]), names))).toEqual([]);
  });
  it("a first observation starts from submitted", () => {
    expect(stageSteps(null, buildRequest(received(), names)).map((s) => s.stage)).toEqual([
      "submitted",
      "dispute-relaying",
      "dispute-received",
    ]);
  });
  it("a failure follows the stage it failed in", () => {
    const r = buildRequest(base({ dispute: leg([0, 1], { failure: "x" }) }), names);
    expect(stageSteps(null, r).map((s) => s.stage)).toEqual(["submitted", "dispute-relaying", "failed"]);
  });
  it("projectTo resets the later leg's reports", () => {
    const p = projectTo(buildRequest(switched(), names), "ruled");
    expect(p.reports.filter((x) => x.leg === "ruling").every((x) => x.status === "pending")).toBe(true);
    expect(p.reports.filter((x) => x.leg === "dispute").some((x) => x.status === "reported")).toBe(true);
  });
});
