import { describe, expect, it } from "vitest";
import type { Oracle, RequestStage, StageTx, SwitchRequest } from "../data";
import { describeRevert } from "../data/errors";
import { requestModel, previewModel, FAILURE_NODE_TITLES, NODE_TITLES, PREVIEW_NODE_TITLES } from "./circuitModel";
import {
  AGREEMENT_HINT,
  FORBIDDEN_TEXT,
  helpNote,
  helpStages,
  helpTerms,
  REQUEST_INTRO,
  requestIntro,
  type CopyNetwork,
} from "./copy";
import { sendFailure } from "./errors";
import { actionModels, logEntries, nowModel, pausedModel, STAGE_LABEL, txName } from "./trackModel";

const names = { foreign: "Base-like", home: "Arbitrum-like" };
const testnetNames = { foreign: "Base Sepolia", home: "Arbitrum Sepolia", testnet: true };
const oracles: Oracle[] = ["Vea", "CCIP", "LayerZero"].map((name, id) => ({
  id,
  name,
  via: `${name}Reporter · ${name}Adapter`,
  enabled: true,
  bridgingCostWei: 1n,
}));
const tx = (stage: StageTx["stage"], n: number): StageTx => ({
  stage,
  chain: stage === "submitted" || stage === "switched" || stage === "closed" ? "foreign" : "home",
  label: "requestSwitch",
  hash: `0x${n.toString(16).padStart(64, "0")}`,
});
const SUCCESS: RequestStage[] = ["submitted", "dispute-relaying", "dispute-delivered", "dispute-received", "ruled", "ruling-relaying", "switched"];
const FAILURE: RequestStage[] = ["creation-failed", "failure-relaying", "closed"];
const STAGES: RequestStage[] = [...SUCCESS, ...FAILURE, "failed"];
// A paused delivery: a plain first paragraph that names the cause and the action, then the technical detail.
const PAUSE = "The court side refuses the delivery. Its operator needs to fix that.\nThe HomeGateway on Arbitrum-like reverted with UnexpectedAdapters.";
const BLOCKER = describeRevert({ errorName: "InsufficientFunds", args: [10n ** 17n, 0n] }, { homeChainName: "Arbitrum-like" })!;
const TESTNET_BLOCKER = describeRevert(
  { errorName: "InsufficientFunds", args: [10n ** 17n, 0n] },
  { homeChainName: "Arbitrum Sepolia", network: "testnet" },
)!;

function req(stage: RequestStage, over: Partial<SwitchRequest> = {}): SwitchRequest {
  const past = (s: RequestStage[]) => s.includes(stage);
  const failurePath = past(FAILURE);
  return {
    disputeId: 7n,
    homeDisputeId: past(["dispute-received", "ruled", "ruling-relaying", "switched"]) ? 3n : null,
    owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    selection: { oracleIds: [0, 1, 2], threshold: 2 },
    paid: { token: "native", amount: 1n },
    stage,
    ruling: past(["ruled", "ruling-relaying", "switched"]) ? 1 : 0,
    reports: [
      { oracleId: 0, leg: "dispute", status: "reported" },
      { oracleId: 1, leg: "dispute", status: stage === "dispute-relaying" ? "pending" : "reported" },
    ],
    txs: [tx("submitted", 1), ...(failurePath ? [tx("dispute-delivered", 2), tx("creation-failed", 3)] : [])],
    error: stage === "failed" ? PAUSE : null,
    creation:
      past(["dispute-delivered", "dispute-received", "ruled", "ruling-relaying", "switched"]) || failurePath
        ? { state: stage === "dispute-delivered" ? "waiting" : failurePath ? "failed" : "created", deliveredAt: 0, failableAt: 60_000, blocker: null }
        : null,
    refund: stage === "closed" ? { token: "native", amount: 2n, claimed: null } : null,
    actions: stage === "closed" ? ["claim-refund"] : [],
    updatedAt: 0,
    ...over,
  };
}

/** The other situations a page can show: a blocked or expired creation window, a claimed refund, a paused failure leg. */
const variants = (blocker = BLOCKER): SwitchRequest[] => {
  const waiting = req("dispute-delivered");
  return [
    { ...waiting, creation: { ...waiting.creation!, blocker } },
    { ...waiting, creation: { ...waiting.creation!, blocker }, actions: ["send-failure"] },
    { ...waiting, actions: ["create-dispute", "send-failure"] },
    req("dispute-relaying", { actions: ["deliver"] }),
    req("ruling-relaying", { actions: ["deliver-back"] }),
    req("ruling-relaying", { actions: ["execute-ruling"] }),
    req("failure-relaying", { actions: ["execute-ruling"] }),
    req("closed", { refund: { token: "native", amount: 2n, claimed: { tx: tx("closed", 9).hash, beneficiary: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" } }, actions: [] }),
    req("failed", { txs: [tx("submitted", 1), tx("dispute-delivered", 2), tx("creation-failed", 3)] }),
  ];
};

const allText = (): string[] => {
  const out: string[] = [AGREEMENT_HINT, ...Object.values(STAGE_LABEL), ...Object.values(NODE_TITLES), ...Object.values(FAILURE_NODE_TITLES), ...Object.values(PREVIEW_NODE_TITLES)];
  for (const network of ["devnet", "testnet"] as CopyNetwork[]) {
    out.push(requestIntro(network), helpNote(network));
    for (const h of helpStages(network)) out.push(h.lead, h.rest);
    for (const t of helpTerms(network)) out.push(t.term, t.text);
  }
  for (const n of [names, testnetNames]) {
    for (const r of [...STAGES.map((stage) => req(stage)), ...variants()]) {
      for (const canSimulate of [true, false]) {
        const m = nowModel(r, oracles, n, { canSimulate, amount: (v) => `${v} wei` });
        out.push(m.title, m.body, m.statusText, m.next, m.counts ?? "");
        if (m.bulbNow) out.push(m.bulbNow.label, m.bulbNow.value, m.bulbNow.differs ?? "");
      }
      for (const e of logEntries(r, oracles, n)) out.push(e.title, e.word ?? "");
      for (const a of actionModels(r, n, { selfServe: true, amount: (v) => `${v} wei` })) out.push(a.label, a.note);
      const m = requestModel(r, oracles, n, { kind: "known", on: true });
      out.push(...m.bulbLabel, m.dispute.caption, m.ruling.caption, ...Object.values(m.sub));
      for (const t of r.txs) out.push(txName(t));
      if (r.stage === "failed") {
        const p = pausedModel(r, n);
        out.push(p.title, p.lastStep, p.message, p.operatorAction, p.warning);
      }
    }
  }
  out.push(...previewModel(oracles, [], 1, { kind: "disconnected" }, names).bulbLabel, previewModel(oracles, [], 1, { kind: "disconnected" }, names).dispute.caption);
  out.push(...previewModel(oracles, [0, 1], 2, { kind: "known", on: true }, names).bulbLabel);
  for (const e of [
    new Error("Cancelled before sending.\nSimulation reverted: InsufficientPayment"),
    new Error("Transaction failed: network gas may have been used.\nReverted with InvalidThreshold"),
    new Error("User rejected the request."),
    new Error("Something odd\nwith detail"),
  ]) {
    const f = sendFailure(e);
    out.push(f.title, f.message, f.advice);
  }
  // the first paragraph of each data-layer reason is shown by default; the rest only under the details
  for (const network of ["devnet", "testnet"] as const)
    for (const [errorName, args] of [
      ["InsufficientFunds", [1n, 0n]],
      ["ReporterCannotPay", ["Vea", 1n, 0n]],
      ["ThresholdBelowMinimum", [3n]],
      ["CreationTimeoutNotPassed", []],
      ["DisputeAlreadyCreated", []],
      ["CreationFailureAlreadySent", []],
      ["RulingNotReceived", []],
      ["RulingAlreadyExecuted", []],
      ["NoRefundPending", []],
      ["RulerOnly", []],
      ["RulingModeNotSet", []],
    ] as const)
      out.push(describeRevert({ errorName, args }, { network, homeChainName: "Arbitrum Sepolia" })!.split("\n")[0]);
  return out;
};

describe("default-view copy", () => {
  it("matches none of the forbidden patterns", () => {
    for (const text of allText())
      for (const re of FORBIDDEN_TEXT) expect(text, `"${text}" vs ${re}`).not.toMatch(re);
  });

  it("applies the copy replacements", () => {
    expect(REQUEST_INTRO).toBe("Send a request through two local chains, then simulate the court's decision on Track.");
    expect(nowModel(req("dispute-received"), oracles, names, { canSimulate: true }).title).toBe(
      "Your turn: simulate the court decision",
    );
    expect(nowModel(req("dispute-received"), oracles, names, { canSimulate: false }).title).not.toMatch(/jurors/i);
    expect(nowModel(req("ruled"), oracles, names, { canSimulate: true }).title).toBe(
      "Decision submitted. Waiting for return delivery…",
    );
    for (const stage of STAGES) {
      const t = nowModel(req(stage), oracles, names, { canSimulate: false }).title;
      expect(t, `${stage} headline`).not.toMatch(/(^|\W)Request sent(?=$|\W)/);
    }
    expect(Object.values(NODE_TITLES)).toEqual(["Request sent", "Delivered", "Decision", "Decision returning", "Bulb updated"]);
    expect(Object.values(FAILURE_NODE_TITLES)).toEqual(["Request sent", "Delivered", "Case not opened", "Failure returning", "Request closed"]);
    expect(previewModel(oracles, [0], 1, { kind: "known", on: true }, names).bulbLabel[1]).toBe("Current bulb state on Base-like");
    expect(previewModel(oracles, [0, 1], 2, { kind: "known", on: true }, names).dispute.caption).toBe("2 of 2 must agree");
    expect(previewModel(oracles, [], 1, { kind: "known", on: true }, names).dispute.caption).toBe("Choose an oracle first");
    expect(requestModel(req("dispute-relaying"), oracles, names).dispute.caption).toBe("1 reported · 2 required");
  });

  it("keeps the log to the seven plain stages plus oracle rows, on either path", () => {
    for (const r of [req("dispute-relaying"), req("closed")]) {
      const e = logEntries(r, oracles, names);
      expect(e.filter((x) => !x.report)).toHaveLength(7);
      expect(e.map((x) => x.title).join(" ")).not.toMatch(/adapter|reporter|onMessage/i);
    }
  });

  it("words the testnet build without the local devnet, its operator or local ETH", () => {
    const testnetText = [
      requestIntro("testnet"),
      helpNote("testnet"),
      ...helpStages("testnet").flatMap((h) => [h.lead, h.rest]),
      ...helpTerms("testnet").flatMap((t) => [t.term, t.text]),
      ...[...STAGES.map((stage) => req(stage)), ...variants(TESTNET_BLOCKER)].flatMap((r) => [
        ...logEntries(r, oracles, testnetNames).map((e) => e.title),
        ...(r.stage === "failed" ? Object.values(pausedModel(r, testnetNames)).map(String) : []),
        ...Object.values(nowModel(r, oracles, testnetNames, { canSimulate: false })).filter((v): v is string => typeof v === "string"),
      ]),
      describeRevert({ errorName: "InsufficientFunds", args: [1n, 0n] }, { network: "testnet" })!,
    ];
    for (const text of testnetText) expect(text, text).not.toMatch(/local (devnet|demo|operator|ETH|network)|this machine|yarn devnet/i);
    expect(helpTerms("testnet").find((t) => t.term === "tx 0x…")?.text).toMatch(/block explorer/);
  });
});

describe("creation failure copy", () => {
  it("says why the case is waiting, then offers the failure once the window closes", () => {
    const waiting = req("dispute-delivered");
    const blocked = { ...waiting, creation: { ...waiting.creation!, blocker: BLOCKER } };
    const n = nowModel(blocked, oracles, names, { canSimulate: false });
    expect(`${n.title} ${n.body}`).toMatch(/lacks local ETH to open the case/);
    expect(logEntries(blocked, oracles, names).find((e) => e.key === "dispute-received")).toMatchObject({
      title: "Court cannot open the case yet",
      word: "Waiting",
    });
    const expired = { ...blocked, actions: ["send-failure" as const] };
    expect(logEntries(expired, oracles, names).find((e) => e.key === "dispute-received")).toMatchObject({
      title: "Court did not open the case in time",
      word: "Window closed",
    });
    const [send] = actionModels(expired, names, { selfServe: false });
    expect(send).toMatchObject({ action: "send-failure", label: "Send the failure back", chain: "home" });
    expect(send.note).toMatch(/juror fees are refunded/);
  });

  it("closes the request with the bulb unchanged and the refund due, then claimed", () => {
    const due = req("closed");
    expect(STAGE_LABEL.closed).toMatch(/^Closed/);
    expect(logEntries(due, oracles, names).at(-1)?.title).toBe("Request closed · refund available");
    const [claim] = actionModels(due, names, { selfServe: false, amount: (v) => `${v} wei` });
    expect(claim).toMatchObject({ action: "claim-refund", label: "Claim refund · 2 wei", chain: "foreign" });
    expect(requestModel(due, oracles, names, { kind: "known", on: false }).bulbLabel.join(" ")).toMatch(/unchanged/i);
    const claimed = variants().find((r) => r.stage === "closed" && r.refund?.claimed)!;
    expect(logEntries(claimed, oracles, names).at(-1)?.title).toBe("Request closed · juror fees refunded");
    expect(actionModels(claimed, names, { selfServe: true })).toEqual([]);
  });

  it("offers the relay steps only where nobody else runs them (the testnets)", () => {
    const deliver = req("dispute-relaying", { actions: ["deliver"] });
    expect(actionModels(deliver, names, { selfServe: false })).toEqual([]);
    expect(actionModels(deliver, testnetNames, { selfServe: true }).map((a) => a.label)).toEqual(["Deliver to Arbitrum Sepolia"]);
  });
});

describe("failure copy", () => {
  it("tells a cancelled send, a mined revert and the unknown case apart", () => {
    const cancelled = sendFailure(new Error("Cancelled before sending.\nSimulation reverted: InsufficientPayment"));
    expect(cancelled.kind).toBe("cancelled");
    expect(cancelled.title).toBe("Cancelled before sending");
    expect(cancelled.message).toBe("Cancelled before sending.");
    expect(cancelled.detail).toContain("InsufficientPayment");

    const failed = sendFailure(new Error("Transaction failed: network gas may have been used.\nReverted with InvalidThreshold"));
    expect(failed.kind).toBe("failed");
    expect(failed.title).toBe("Transaction failed—network gas may have been used");
    expect(failed.detail).toBe("Reverted with InvalidThreshold");

    const rejected = sendFailure(new Error("User rejected the request."));
    expect(rejected.kind).toBe("cancelled");

    const unknown = sendFailure(new Error("Something odd happened"));
    expect(unknown.kind).toBe("unknown");
    expect(unknown.advice).toMatch(/Track/);
    expect(unknown.advice).toMatch(/twice|duplicate/);
  });

  it("shows only the first paragraph of a data-layer error and keeps the rest as detail", () => {
    const f = sendFailure(new Error("This oracle's relay service lacks local ETH.\nReporter 0xabc balance 0 wei"));
    expect(f.message).toBe("This oracle's relay service lacks local ETH.");
    expect(f.detail).toBe("Reporter 0xabc balance 0 wei");
  });

  it("words a paid request whose delivery paused, with the last step, the operator action and a duplicate warning", () => {
    const p = pausedModel(req("failed"), names);
    expect(p.title).toBe("Request paid; delivery paused");
    expect(p.lastStep).toBe("Oracles delivering the request");
    // the chain's paragraph (the cause and the fund-it action) is said once, in the status body, not again in the operator line
    const n = nowModel(req("failed"), oracles, names, { canSimulate: false });
    const panel = `${n.title} ${n.body} ${p.lastStep} ${p.operatorAction} ${p.warning}`;
    expect(panel.split(p.message).length - 1).toBe(1);
    expect(n.body).toMatch(/court side.*fix that/);
    expect(`${p.title} ${p.lastStep} ${p.message} ${p.operatorAction} ${p.warning}`).not.toMatch(/relay service/i);
    expect(p.warning).toMatch(/duplicate/);
    expect(p.message).toMatch(/^The court side refuses the delivery/);
    expect(p.detail).toMatch(/^The HomeGateway/);
    // a paid request's failure is never worded as a cancelled send
    expect(`${p.title} ${p.message} ${p.operatorAction}`).not.toMatch(/Cancelled before sending|Nothing was charged|Safe\. Already paid/i);
  });

  it("states the bulb only from a resolved read, not from the ruling", () => {
    const sw = req("switched");
    for (const bulb of [{ kind: "loading" }, { kind: "failed" }] as const) {
      const n = nowModel(sw, oracles, names, { canSimulate: false, bulb });
      expect(`${n.title} ${n.body}`).not.toMatch(/bulb is (on|off)|waiting for the decision/i);
      expect(n.title).toMatch(/^Request complete · bulb set (On|Off)$/);
      expect(n.next).not.toMatch(/Nothing\. Done/);
    }
    const failed = nowModel(sw, oracles, names, { canSimulate: false, bulb: { kind: "failed" } });
    expect(failed.bulbNow).toMatchObject({ label: "Requester's bulb now", value: "Current bulb state unavailable", retry: true });
    expect(failed.next).toBe("Retry the bulb check.");
    expect(nowModel(sw, oracles, names, { canSimulate: false, bulb: { kind: "loading" } }).bulbNow?.value).toBe("Checking bulb…");
    // the historical outcome leads; the current bulb is a separate field, "Your" only for the requester
    const ruledOn = { ...sw, ruling: 1 as const };
    const off = nowModel(ruledOn, oracles, names, { canSimulate: false, bulb: { kind: "known", on: false } });
    expect(off.title).toBe("Request complete · bulb set On");
    expect(off.bulbNow).toMatchObject({ label: "Requester's bulb now", value: "Off", differs: "The current state differs from this request's result." });
    const same = nowModel(ruledOn, oracles, names, { canSimulate: false, bulb: { kind: "known", on: true }, mine: true });
    expect(same.bulbNow).toMatchObject({ label: "Your bulb now", value: "On", differs: null });
    const step = logEntries(sw, oracles, names).find((e) => /^Bulb updated/.test(e.title));
    expect(step?.title).not.toMatch(/\b(on|off)$/);
  });
});
