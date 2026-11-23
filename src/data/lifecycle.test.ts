import { describe, expect, it } from "vitest";
import {
  buildRequest,
  FAILURE_STAGES,
  isFailurePath,
  isFinal,
  projectTo,
  reachedStage,
  stageSteps,
  STAGES,
  type LegFacts,
  type RequestFacts,
} from "./lifecycle";
import type { Address, Hex } from "./types";

const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const OWNER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const names = (id: number) => ["Vea", "CCIP", "LayerZero", "deBridge"][id];

const leg = (reported: number[], extra: Partial<LegFacts> = {}): LegFacts => ({
  messageId: 7n,
  dispatchTx: h(1),
  reports: [0, 1, 2].map((oracleId) => ({ oracleId, txHash: reported.includes(oracleId) ? h(100 + oracleId) : null })),
  executedTx: null,
  failure: null,
  executable: false,
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

const relaying = (n: number[]) => base({ dispute: leg(n) });
const delivered = (over: Partial<RequestFacts> = {}) =>
  base({ dispute: leg([0, 1], { executedTx: h(10) }), delivered: { at: 1200, failableAt: 1800 }, ...over });
const received = () => delivered({ created: { tx: h(11), homeDisputeId: 0n } });
const ruled = (value = 1n) => ({ ...received(), ruling: { value, tx: h(20) } });
const rulingRelaying = (n: number[], value = 1n) => ({ ...ruled(value), rulingLeg: leg(n, { dispatchTx: h(20), messageId: 8n }) });
const switched = (value = 1n) => ({
  ...ruled(value),
  rulingLeg: leg([0, 1, 2], { dispatchTx: h(20), messageId: 8n, executedTx: h(30) }),
  switched: { tx: h(31) },
});
const creationFailed = () => delivered({ homeTime: 1900, creationFailure: { tx: h(40) } });
const failureRelaying = (n: number[], extra: Partial<LegFacts> = {}) => ({
  ...creationFailed(),
  rulingLeg: leg(n, { dispatchTx: h(40), messageId: 9n, ...extra }),
});
const closed = (claimed = false) => ({
  ...failureRelaying([0, 1, 2], { executedTx: h(50) }),
  closed: { tx: h(51) },
  refund: { token: "native" as const, amount: 3n, claimed: claimed ? { tx: h(60), beneficiary: OWNER } : null },
  refundPending: !claimed,
});

describe("buildRequest: each stage of the success path", () => {
  it("submitted: the request transaction only", () => {
    const r = buildRequest(base(), names);
    expect(r.stage).toBe("submitted");
    expect(r.txs).toEqual([{ stage: "submitted", chain: "foreign", label: "requestSwitch", hash: h(1) }]);
    expect(r.homeDisputeId).toBeNull();
    expect(r.ruling).toBe(0);
    expect(r.creation).toBeNull();
    expect(r.actions).toEqual([]);
  });
  it("dispute-relaying: per-oracle reports, one storeHash tx each on the home chain", () => {
    const r = buildRequest(relaying([1]), names);
    expect(r.stage).toBe("dispute-relaying");
    expect(r.reports.filter((x) => x.leg === "dispute").map((x) => x.status)).toEqual(["pending", "reported", "pending"]);
    expect(r.reports.filter((x) => x.leg === "ruling").every((x) => x.status === "pending")).toBe(true);
    expect(r.txs[1]).toEqual({ stage: "dispute-relaying", chain: "home", label: "storeHash · CCIP", hash: h(101) });
  });
  it("dispute-relaying: offers the delivery once a simulated execute goes through", () => {
    expect(buildRequest(base({ dispute: leg([0, 1], { executable: true }) }), names).actions).toEqual(["deliver"]);
  });
  it("dispute-delivered: the delivery transaction and a waiting creation window", () => {
    const r = buildRequest(delivered(), names);
    expect(r.stage).toBe("dispute-delivered");
    expect(r.txs.at(-1)).toEqual({ stage: "dispute-delivered", chain: "home", label: "executeMessages", hash: h(10) });
    expect(r.creation).toEqual({ state: "waiting", deliveredAt: 1200, failableAt: 1800, blocker: null });
    expect(r.homeDisputeId).toBeNull();
    expect(r.actions).toEqual(["create-dispute"]);
  });
  it("dispute-delivered: a blocker hides the create step; the failure is offered once the home clock passes the window", () => {
    const blocked = buildRequest(delivered({ creationBlocker: "lacks the ETH" }), names);
    expect(blocked.creation?.blocker).toBe("lacks the ETH");
    expect(blocked.actions).toEqual([]);
    expect(buildRequest(delivered({ creationBlocker: "lacks the ETH", homeTime: 1800 }), names).actions).toEqual(["send-failure"]);
    expect(buildRequest(delivered({ homeTime: 1801 }), names).actions).toEqual(["create-dispute", "send-failure"]);
  });
  it("an executed dispute message the HomeGateway has not recorded is still relaying", () => {
    expect(buildRequest(base({ dispute: leg([0, 1], { executedTx: h(10) }) }), names).stage).toBe("dispute-relaying");
  });
  it("dispute-received: needs created (never a non-zero id: home dispute 0 exists)", () => {
    const r = buildRequest(received(), names);
    expect(r.stage).toBe("dispute-received");
    expect(r.homeDisputeId).toBe(0n);
    expect(r.creation?.state).toBe("created");
    expect(r.txs.at(-1)).toEqual({ stage: "dispute-received", chain: "home", label: "createReceivedDispute", hash: h(11) });
    expect(r.actions).toEqual([]);
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
  it("ruling-relaying: offers the delivery back, then the ruling's execution once delivered", () => {
    const deliverable = rulingRelaying([0, 1]);
    deliverable.rulingLeg!.executable = true;
    expect(buildRequest(deliverable, names).actions).toEqual(["deliver-back"]);
    const recorded = rulingRelaying([0, 1]);
    recorded.rulingLeg!.executedTx = h(30);
    const r = buildRequest(recorded, names);
    expect(r.stage).toBe("ruling-relaying");
    expect(r.txs.at(-1)).toMatchObject({ stage: "ruling-relaying", chain: "foreign", label: "executeMessages" });
    expect(r.actions).toEqual(["execute-ruling"]);
  });
  it("switched: the ForeignGateway executeRuling transaction, every stage, final", () => {
    const r = buildRequest(switched(1n), names);
    expect(r.stage).toBe("switched");
    expect(r.ruling).toBe(1);
    expect(r.txs.at(-1)).toEqual({ stage: "switched", chain: "foreign", label: "executeRuling", hash: h(31) });
    expect([...new Set(r.txs.map((t) => t.stage))]).toEqual(STAGES);
    expect(r.error).toBeNull();
    expect(r.actions).toEqual([]);
    expect(isFinal(r)).toBe(true);
    expect(isFailurePath(r)).toBe(false);
  });
});

describe("buildRequest: the creation-failure path", () => {
  it("creation-failed: the sendCreationFailure transaction, no court case, no ruling", () => {
    const r = buildRequest(creationFailed(), names);
    expect(r.stage).toBe("creation-failed");
    expect(r.txs.at(-1)).toEqual({ stage: "creation-failed", chain: "home", label: "sendCreationFailure", hash: h(40) });
    expect(r.creation?.state).toBe("failed");
    expect(r.creation?.blocker).toBeNull();
    expect(r.homeDisputeId).toBeNull();
    expect(r.ruling).toBe(0);
    expect(r.actions).toEqual([]);
    expect(isFailurePath(r)).toBe(true);
  });
  it("failure-relaying: the failure's reports come back on the foreign chain", () => {
    const r = buildRequest(failureRelaying([2]), names);
    expect(r.stage).toBe("failure-relaying");
    expect(r.reports.filter((x) => x.leg === "ruling").map((x) => x.status)).toEqual(["pending", "pending", "reported"]);
    expect(r.txs.at(-1)).toMatchObject({ stage: "failure-relaying", chain: "foreign", label: "storeHash · LayerZero" });
    expect(buildRequest(failureRelaying([0, 1], { executable: true }), names).actions).toEqual(["deliver-back"]);
    expect(buildRequest(failureRelaying([0, 1], { executedTx: h(50) }), names).actions).toEqual(["execute-ruling"]);
  });
  it("closed: the refund is due, then claimed; the request is final once claimed", () => {
    const due = buildRequest(closed(), names);
    expect(due.stage).toBe("closed");
    expect(due.refund).toEqual({ token: "native", amount: 3n, claimed: null });
    expect(due.actions).toEqual(["claim-refund"]);
    expect(isFinal(due)).toBe(false);
    expect([...new Set(due.txs.map((t) => t.stage))]).toEqual(FAILURE_STAGES);
    const done = buildRequest(closed(true), names);
    expect(done.txs.at(-1)).toEqual({ stage: "closed", chain: "foreign", label: "claimRefund", hash: h(60) });
    expect(done.actions).toEqual([]);
    expect(isFinal(done)).toBe(true);
  });
  it("a refund is only shown once the request is closed", () => {
    const r = buildRequest({ ...failureRelaying([0, 1, 2], { executedTx: h(50) }), refund: { token: "native", amount: 3n, claimed: null } }, names);
    expect(r.stage).toBe("failure-relaying");
    expect(r.refund).toBeNull();
  });
});

describe("buildRequest: failures", () => {
  it("a dispute leg whose execution would revert is failed with the reason; unreported oracles are failed", () => {
    const r = buildRequest(base({ dispute: leg([0, 1], { failure: "The HomeGateway ... must fund it" }) }), names);
    expect(r.stage).toBe("failed");
    expect(r.error).toMatch(/must fund it/);
    expect(r.reports.filter((x) => x.leg === "dispute").map((x) => x.status)).toEqual(["reported", "reported", "failed"]);
    expect(r.actions).toEqual([]);
    expect(reachedStage(r)).toBe("dispute-relaying");
  });
  it("a ruling leg failure keeps the earlier stages' transactions", () => {
    const facts = rulingRelaying([0, 1]);
    facts.rulingLeg!.failure = "reverted";
    const r = buildRequest(facts, names);
    expect(r.stage).toBe("failed");
    expect(r.ruling).toBe(1);
    expect(r.homeDisputeId).toBe(0n);
    expect(r.txs.map((t) => t.stage)).toContain("ruled");
    expect(reachedStage(r)).toBe("ruling-relaying");
  });
  it("a failure leg that cannot be delivered stays on the failure path", () => {
    const r = buildRequest(failureRelaying([0, 1], { failure: "reverted" }), names);
    expect(r.stage).toBe("failed");
    expect(isFailurePath(r)).toBe(true);
    expect(reachedStage(r)).toBe("failure-relaying");
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
    expect(steps[1].creation?.state).toBe("waiting");
    expect(steps[1].homeDisputeId).toBeNull();
    expect(steps[2].homeDisputeId).toBe(0n);
    expect(steps[3].ruling).toBe(1);
    expect(steps[2].ruling).toBe(0);
    expect(steps.slice(0, -1).every((s) => s.actions.length === 0)).toBe(true);
  });
  it("walks the failure path in order", () => {
    const steps = stageSteps(buildRequest(delivered(), names), buildRequest(closed(true), names));
    expect(steps.map((s) => s.stage)).toEqual(["creation-failed", "failure-relaying", "closed"]);
    expect(steps[0].refund).toBeNull();
    expect(steps[0].txs.some((t) => t.label === "claimRefund")).toBe(false);
    expect(steps[2].refund?.claimed?.tx).toBe(h(60));
  });
  it("reports progress within a stage (another oracle reported, a blocker cleared, a step came due)", () => {
    const one = buildRequest(relaying([0]), names);
    const two = buildRequest(relaying([0, 2]), names);
    expect(stageSteps(one, two)).toEqual([two]);
    expect(stageSteps(two, buildRequest(relaying([0, 2]), names))).toEqual([]);
    const blocked = buildRequest(delivered({ creationBlocker: "x" }), names);
    expect(stageSteps(blocked, buildRequest(delivered(), names))).toHaveLength(1);
    expect(stageSteps(blocked, buildRequest(delivered({ creationBlocker: "x", homeTime: 1900 }), names))).toHaveLength(1);
  });
  it("reports the refund claim on a closed request", () => {
    expect(stageSteps(buildRequest(closed(), names), buildRequest(closed(true), names))).toHaveLength(1);
  });
  it("a first observation starts from submitted", () => {
    expect(stageSteps(null, buildRequest(received(), names)).map((s) => s.stage)).toEqual([
      "submitted",
      "dispute-relaying",
      "dispute-delivered",
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
