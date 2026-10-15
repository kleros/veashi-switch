import { describe, expect, it } from "vitest";
import type { Oracle, RequestStage, StageTx, SwitchRequest } from "../data";
import { requestModel, previewModel, NODE_TITLES, PREVIEW_NODE_TITLES } from "./circuitModel";
import { AGREEMENT_HINT, FORBIDDEN_TEXT, HELP_NOTE, HELP_STAGES, HELP_TERMS, REQUEST_INTRO } from "./copy";
import { sendFailure } from "./errors";
import { logEntries, nowModel, pausedModel, STAGE_LABEL, txName } from "./trackModel";

const names = { foreign: "Base-like", home: "Arbitrum-like" };
const oracles: Oracle[] = ["Vea", "CCIP", "LayerZero"].map((name, id) => ({
  id,
  name,
  via: `${name}Reporter · ${name}Adapter`,
  enabled: true,
  bridgingCostWei: 1n,
}));
const tx = (stage: StageTx["stage"], n: number): StageTx => ({
  stage,
  chain: stage === "submitted" || stage === "switched" ? "foreign" : "home",
  label: "requestSwitch",
  hash: `0x${n.toString(16).padStart(64, "0")}`,
});
const STAGES: RequestStage[] = ["submitted", "dispute-relaying", "dispute-received", "ruled", "ruling-relaying", "switched", "failed"];

function req(stage: RequestStage): SwitchRequest {
  const past = (s: RequestStage[]) => s.includes(stage);
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
    txs: [tx("submitted", 1)],
    error: stage === "failed" ? "The court side of this local devnet lacks local ETH to open the case. The local operator needs to fund it.\nThe HomeGateway on Arbitrum-like needs 0.1 ETH and holds 0 ETH; the case is created as soon as it is funded." : null,
    updatedAt: 0,
  };
}

const allText = (): string[] => {
  const out: string[] = [REQUEST_INTRO, AGREEMENT_HINT, HELP_NOTE, ...Object.values(STAGE_LABEL), ...Object.values(NODE_TITLES), ...Object.values(PREVIEW_NODE_TITLES)];
  for (const h of HELP_STAGES) out.push(h.lead, h.rest);
  for (const t of HELP_TERMS) out.push(t.term, t.text);
  for (const stage of STAGES) {
    const r = req(stage);
    for (const canSimulate of [true, false]) {
      const n = nowModel(r, oracles, names, { canSimulate });
      out.push(n.title, n.body, n.statusText, n.next, n.counts ?? "");
    }
    for (const e of logEntries(r, oracles, names)) out.push(e.title);
    const m = requestModel(r, oracles, names, { kind: "known", on: true });
    out.push(...m.bulbLabel, m.dispute.caption, m.ruling.caption, ...Object.values(m.sub));
    out.push(txName(tx("ruled", 1)));
    if (stage === "failed") {
      const p = pausedModel(r, names);
      out.push(p.title, p.lastStep, p.message, p.operatorAction, p.warning);
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
    expect(Object.values(NODE_TITLES)).toEqual(["Request sent", "Court received", "Decision", "Decision returning", "Bulb updated"]);
    expect(previewModel(oracles, [0], 1, { kind: "known", on: true }, names).bulbLabel[1]).toBe("Current bulb state on Base-like local devnet");
    expect(previewModel(oracles, [0, 1], 2, { kind: "known", on: true }, names).dispute.caption).toBe("2 of 2 must agree");
    expect(previewModel(oracles, [], 1, { kind: "known", on: true }, names).dispute.caption).toBe("Choose an oracle first");
    expect(requestModel(req("dispute-relaying"), oracles, names).dispute.caption).toBe("1 reported · 2 required");
  });

  it("keeps the log to the six plain stages plus oracle rows", () => {
    const e = logEntries(req("dispute-relaying"), oracles, names);
    expect(e.filter((x) => !x.report)).toHaveLength(6);
    expect(e.map((x) => x.title).join(" ")).not.toMatch(/adapter|reporter|onMessage/i);
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
    expect(n.body).toMatch(/court side.*fund it/);
    expect(`${p.title} ${p.lastStep} ${p.message} ${p.operatorAction} ${p.warning}`).not.toMatch(/relay service/i);
    expect(p.warning).toMatch(/duplicate/);
    expect(p.message).toMatch(/^The court side of this local devnet lacks local ETH/);
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
