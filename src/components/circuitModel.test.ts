import { describe, expect, it } from "vitest";
import type { Oracle, RequestStage, StageTx, SwitchRequest } from "../data";
import { previewModel, requestModel } from "./circuitModel";
import { logEntries } from "./trackModel";

const names = { foreign: "Base-like", home: "Arbitrum-like" };
const oracles: Oracle[] = ["Vea", "CCIP", "LayerZero", "deBridge"].map((name, id) => ({
  id,
  name,
  via: `${name}Reporter · ${name}Adapter`,
  enabled: true,
  bridgingCostWei: 1n,
}));
const tx = (stage: StageTx["stage"], n: number): StageTx => ({
  stage,
  chain: stage === "submitted" || stage === "switched" ? "foreign" : "home",
  label: stage,
  hash: `0x${n.toString(16).padStart(64, "0")}`,
});

function req(stage: RequestStage, over: Partial<SwitchRequest> = {}): SwitchRequest {
  return {
    disputeId: 7n,
    homeDisputeId: null,
    owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    selection: { oracleIds: [0, 1, 2], threshold: 2 },
    paid: { token: "native", amount: 1n },
    stage,
    ruling: 0,
    reports: [],
    txs: [tx("submitted", 1)],
    error: null,
    updatedAt: 0,
    ...over,
  };
}

describe("requestModel", () => {
  it("shows the dispute leg reporting oracle by oracle with the k/n junction", () => {
    const m = requestModel(
      req("dispute-relaying", {
        reports: [
          { oracleId: 0, leg: "dispute", status: "pending" },
          { oracleId: 1, leg: "dispute", status: "pending" },
          { oracleId: 2, leg: "dispute", status: "reported" },
        ],
      }),
      oracles,
      names,
    );
    expect(m.dispute.status).toBe("live");
    expect(m.dispute.oracles).toEqual({ 0: "pending", 1: "pending", 2: "attested" });
    expect(m.dispute.caption).toBe("1 reported · 2 required");
    expect(m.nodes.foreignOut).toBe("done");
    expect(m.tx.foreignOut?.hash).toMatch(/^0x0+1$/);
    expect(m.nodes.homeIn).toBe("idle");
    expect(m.bulb).toBe("waiting");
  });

  it("treats home dispute 0 as received and shows its tx", () => {
    const m = requestModel(req("dispute-received", { homeDisputeId: 0n, txs: [tx("submitted", 1), tx("dispute-received", 2)] }), oracles, names);
    expect(m.nodes.homeIn).toBe("done");
    expect(m.nodes.court).toBe("active");
    expect(m.sub.court).toContain("#0");
    expect(m.tx.homeIn).toBeDefined();
  });

  it("ends with the bulb on for ruling 1 and off for ruling 2, every node done with a tx", () => {
    const txs = [tx("submitted", 1), tx("dispute-received", 2), tx("ruled", 3), tx("switched", 4)];
    const on = requestModel(req("switched", { homeDisputeId: 3n, ruling: 1, txs }), oracles, names, { kind: "known", on: true });
    expect(on.bulb).toBe("on");
    expect(Object.values(on.nodes)).toEqual(["done", "done", "done", "done", "done"]);
    // the ruling and its dispatch share one tx: both nodes show it
    expect(on.tx.court?.hash).toBe(on.tx.homeOut?.hash);
    expect(Object.keys(on.tx)).toHaveLength(5);
    expect(requestModel(req("switched", { homeDisputeId: 3n, ruling: 2, txs }), oracles, names, { kind: "known", on: false }).bulb).toBe("off");
  });

  it("keeps the bulb neutral while the current-state read is pending or failed, never from the ruling", () => {
    const txs = [tx("submitted", 1), tx("dispute-received", 2), tx("ruled", 3), tx("switched", 4)];
    for (const read of [{ kind: "loading" }, { kind: "failed" }] as const) {
      const m = requestModel(req("switched", { homeDisputeId: 3n, ruling: 1, txs }), oracles, names, read);
      expect(m.bulb).toBe("unknown");
      expect(m.bulbLabel.join(" ")).not.toMatch(/bulb (now )?(is )?(on|off)|waiting for the decision/i);
    }
    const sw = (read: Parameters<typeof requestModel>[3], mine = false) =>
      requestModel(req("switched", { homeDisputeId: 3n, ruling: 1, txs }), oracles, names, read, mine);
    expect(sw({ kind: "loading" }).bulbLabel[0]).toBe("Checking bulb…");
    expect(sw({ kind: "failed" }).bulbLabel[0]).toBe("Current bulb state unavailable");
    expect(sw({ kind: "known", on: false }).bulbLabel[0]).toBe("Requester's bulb now: Off");
    expect(sw({ kind: "known", on: true }, true).bulbLabel[0]).toBe("Your bulb now: On");
  });

  it("never draws or announces an unknown Request-page bulb as off", () => {
    const pm = (read: Parameters<typeof previewModel>[3]) => previewModel(oracles, [0], 1, read, names);
    expect(pm({ kind: "disconnected" }).bulb).toBe("unknown");
    expect(pm({ kind: "disconnected" }).bulbLabel[1]).toBe("Connect a wallet to see its state");
    expect(pm({ kind: "loading" }).bulbLabel[0]).toBe("Checking bulb…");
    expect(pm({ kind: "loading" }).bulbLabel.join(" ")).not.toMatch(/Connect a wallet/);
    expect(pm({ kind: "failed" }).bulbLabel[0]).toBe("Couldn't read bulb state");
    expect(pm({ kind: "known", on: false }).bulb).toBe("off");
  });

  it("shows executeRuling on the dispatch node, never a ruling-leg report from the foreign chain", () => {
    const report = (n: number): StageTx => ({ stage: "ruling-relaying", chain: "foreign", label: "storeHash · CCIP", hash: `0x${n.toString(16).padStart(64, "0")}` });
    const ruled = tx("ruled", 3);
    const txs = [tx("submitted", 1), tx("dispute-received", 2), ruled, report(5), report(6), tx("switched", 4)];
    for (const stage of ["ruling-relaying", "switched"] as const) {
      const m = requestModel(req(stage, { homeDisputeId: 3n, ruling: 1, txs }), oracles, names);
      expect(m.tx.homeOut?.hash).toBe(ruled.hash);
      expect(m.tx.court?.hash).toBe(ruled.hash);
    }
  });

  it("marks where a failed request is stuck", () => {
    const m = requestModel(
      req("failed", { error: "HomeGateway is short", reports: [{ oracleId: 0, leg: "dispute", status: "reported" }, { oracleId: 1, leg: "dispute", status: "reported" }] }),
      oracles,
      names,
    );
    expect(m.nodes.homeIn).toBe("fail");
    const stuckLeg = requestModel(req("failed", { reports: [{ oracleId: 1, leg: "dispute", status: "failed" }] }), oracles, names);
    expect(stuckLeg.dispute.status).toBe("fail");
    expect(stuckLeg.dispute.oracles[1]).toBe("fail");
  });
});

describe("previewModel", () => {
  it("draws only the chosen strands and the threshold", () => {
    const m = previewModel(oracles, [0, 2], 2, { kind: "known", on: true }, names);
    expect(m.dispute.oracles).toEqual({ 0: "ready", 2: "ready" });
    expect(m.dispute.caption).toBe("2 of 2 must agree");
    expect(m.bulb).toBe("on");
  });
});

describe("logEntries", () => {
  it("lists the six stages in order with one row per oracle and leg", () => {
    const e = logEntries(req("dispute-relaying"), oracles, names);
    expect(e.filter((x) => !x.report).map((x) => x.key)).toEqual([
      "submitted",
      "dispute-relaying",
      "dispute-received",
      "ruled",
      "ruling-relaying",
      "switched",
    ]);
    expect(e.filter((x) => x.report?.leg === "dispute")).toHaveLength(3);
    expect(e.find((x) => x.key === "dispute-relaying")?.state).toBe("cur");
    expect(e.find((x) => x.key === "dispute-received")?.state).toBe("todo");
  });
});
