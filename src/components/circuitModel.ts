import type { ChainKey, Oracle, OracleReport, RequestStage, StageTx, SwitchRequest } from "../data";
import { rulingName, stageIndex } from "./format";
import type { BulbRead } from "./readState";

export type NodeKey = "foreignOut" | "homeIn" | "court" | "homeOut" | "foreignIn";
export type NodeState = "idle" | "active" | "done" | "fail";
export type StrandState = "off" | "ready" | "pending" | "attested" | "fail";
export type BulbState = "off" | "waiting" | "on" | "unknown";

export interface LegModel {
  status: "ready" | "live" | "done" | "fail";
  oracles: Record<number, StrandState>;
  attested: number;
  caption: string;
}

export interface CircuitModel {
  oracles: { id: number; name: string }[];
  selected: number[];
  threshold: number;
  dispute: LegModel;
  ruling: LegModel;
  nodes: Record<NodeKey, NodeState>;
  titles: Record<NodeKey, string>;
  sub: Record<NodeKey, string>; // the chain (and court case) each node sits on
  tx: Partial<Record<NodeKey, StageTx>>;
  bulb: BulbState;
  bulbLabel: [string, string];
  schematic?: boolean; // the Request preview: no progress words or counts
}

export interface ChainNames {
  foreign: string;
  home: string;
}

export const NODE_TITLES: Record<NodeKey, string> = {
  foreignOut: "Request sent",
  homeIn: "Court received",
  court: "Decision",
  homeOut: "Decision returning",
  foreignIn: "Bulb updated",
};

/** The Request preview draws the route before anything happened: its nodes name actions, not events. */
export const PREVIEW_NODE_TITLES: Record<NodeKey, string> = {
  foreignOut: "Send request",
  homeIn: "Court receives request",
  court: "Decision",
  homeOut: "Decision returns",
  foreignIn: "Update bulb",
};

function nodeSubs(names: ChainNames, home: string): Record<NodeKey, string> {
  return {
    foreignOut: names.foreign,
    homeIn: names.home,
    court: home ? `Court case ${home}` : "Kleros Court",
    homeOut: names.home,
    foreignIn: names.foreign,
  };
}

// Which stage's transaction a finished node shows, first match wins. executeRuling runs HomeGateway.rule and
// dispatches the ruling, so the court and its dispatch share that tx; ruling-leg reports land on the foreign chain.
const NODE_TX: Record<NodeKey, Exclude<RequestStage, "failed">[]> = {
  foreignOut: ["submitted"],
  homeIn: ["dispute-received", "dispute-relaying"],
  court: ["ruled"],
  homeOut: ["ruled", "ruling-relaying"],
  foreignIn: ["switched"],
};

// The chain each node sits on: a node never shows a tx from the other chain.
const NODE_CHAIN: Record<NodeKey, ChainKey> = {
  foreignOut: "foreign",
  homeIn: "home",
  court: "home",
  homeOut: "home",
  foreignIn: "foreign",
};

const NODE_ORDER: NodeKey[] = ["foreignOut", "homeIn", "court", "homeOut", "foreignIn"];

function caption(status: LegModel["status"], attested: number, k: number, n: number): string {
  if (n === 0) return "Choose an oracle first";
  if (status === "fail") return `paused · ${attested} reported · ${k} required`;
  if (status === "ready") return `${k} of ${n} must agree`;
  if (attested >= k) return "agreement reached";
  return `${attested} reported · ${k} required`;
}

function leg(
  selected: number[],
  k: number,
  status: LegModel["status"],
  reports: OracleReport[],
  legName: OracleReport["leg"],
): LegModel {
  const oracles: Record<number, StrandState> = {};
  let attested = 0;
  for (const id of selected) {
    const r = reports.find((x) => x.leg === legName && x.oracleId === id);
    let st: StrandState = status === "live" ? "pending" : status === "done" ? "ready" : "ready";
    if (r?.status === "reported") st = "attested";
    else if (r?.status === "failed") st = "fail";
    else if (r?.status === "pending" && status !== "ready") st = "pending";
    if (st === "attested") attested++;
    oracles[id] = st;
  }
  // once the leg is done, an oracle that never reported is simply not needed
  if (status === "done") for (const id of selected) if (oracles[id] === "pending") oracles[id] = "ready";
  return { status, oracles, attested, caption: caption(status, attested, k, selected.length) };
}

function oracleList(oracles: Oracle[], extra: number[]): { id: number; name: string }[] {
  const list = oracles.map((o) => ({ id: o.id, name: o.name }));
  for (const id of extra) if (!list.some((o) => o.id === id)) list.push({ id, name: `Oracle ${id}` });
  return list.sort((a, b) => a.id - b.id);
}

/** How far a failed request got: the last stage its txs, reports or ids prove. */
export function reachedStage(req: SwitchRequest): number {
  let s = 0;
  for (const t of req.txs) s = Math.max(s, stageIndex(t.stage));
  if (req.reports.some((r) => r.leg === "dispute")) s = Math.max(s, 1);
  if (req.homeDisputeId !== null) s = Math.max(s, 2);
  if (req.ruling !== 0) s = Math.max(s, 3);
  if (req.reports.some((r) => r.leg === "ruling")) s = Math.max(s, 4);
  return s;
}

function txFor(req: SwitchRequest, key: NodeKey): StageTx | undefined {
  for (const stage of NODE_TX[key]) {
    const all = req.txs.filter((t) => t.stage === stage && t.chain === NODE_CHAIN[key]);
    if (all.length) return all[all.length - 1];
  }
  return undefined;
}

/** The circuit for a sent request, at its current stage. */
export function requestModel(
  req: SwitchRequest,
  oracles: Oracle[],
  names: ChainNames,
  /** The requester's current lightbulb state (the same `lightbulbIsOn` the Request page reads). Never inferred from the ruling. */
  bulbRead: BulbRead = { kind: "loading" },
  /** True when the connected wallet is the requester: only then is it "your" bulb. */
  mine = false,
): CircuitModel {
  const failed = req.stage === "failed";
  const s = failed ? reachedStage(req) : stageIndex(req.stage);
  const { oracleIds: selected, threshold: k } = req.selection;
  const dispute = leg(selected, k, s >= 2 ? "done" : "live", req.reports, "dispute");
  const ruling = leg(selected, k, s >= 5 ? "done" : s === 4 ? "live" : "ready", req.reports, "ruling");
  const nodes: Record<NodeKey, NodeState> = {
    foreignOut: "done",
    homeIn: s >= 2 ? "done" : s === 1 && dispute.attested >= k ? "active" : "idle",
    court: s >= 3 ? "done" : s === 2 ? "active" : "idle",
    homeOut: s >= 4 ? "done" : s === 3 ? "active" : "idle",
    foreignIn: s >= 5 ? "done" : s === 4 && ruling.attested >= k ? "active" : "idle",
  };
  if (failed) {
    const next = NODE_ORDER.find((n) => nodes[n] !== "done");
    if (next === "homeIn" && dispute.attested < k) {
      dispute.status = "fail";
      dispute.caption = caption("fail", dispute.attested, k, selected.length);
    } else if (next === "foreignIn" && ruling.attested < k) {
      ruling.status = "fail";
      ruling.caption = caption("fail", ruling.attested, k, selected.length);
    } else if (next) nodes[next] = "fail";
  }
  const tx: Partial<Record<NodeKey, StageTx>> = {};
  for (const n of NODE_ORDER) {
    const t = nodes[n] === "done" ? txFor(req, n) : undefined;
    if (t) tx[n] = t;
  }
  const home = req.homeDisputeId !== null ? `#${req.homeDisputeId.toString()}` : "";
  const sub = nodeSubs(names, home);
  if (s >= 3) sub.court = `${sub.court} · ${req.ruling === 1 ? "On" : "Off"}`;

  let bulb: BulbState = "waiting";
  let bulbLabel: [string, string];
  if (s >= 5 && !failed) {
    const who = mine ? "Your bulb now" : "Requester's bulb now";
    if (bulbRead.kind === "known") {
      bulb = bulbRead.on ? "on" : "off";
      bulbLabel = [`${who}: ${bulbRead.on ? "On" : "Off"}`, `Current bulb state on ${names.foreign} local devnet`];
    } else {
      // unknown: drawn unlit and not called on, off or waiting
      bulb = "unknown";
      bulbLabel =
        bulbRead.kind === "failed"
          ? ["Current bulb state unavailable", "Use Retry bulb check below the status"]
          : ["Checking bulb…", `Looking it up on ${names.foreign} local devnet`];
    }
  } else if (failed) {
    bulbLabel = ["Delivery paused", "See the status above"];
  } else if (s <= 1) {
    bulbLabel = ["Waiting for the decision", `The request is crossing to ${names.home}`];
  } else if (s === 2) {
    bulbLabel = ["Waiting for the court's decision", `Court case ${home}`];
  } else {
    bulbLabel = ["Waiting for delivery", `The decision, ${rulingName(req.ruling)}, is crossing back to ${names.foreign}`];
  }
  return {
    oracles: oracleList(oracles, selected),
    selected,
    threshold: k,
    dispute,
    ruling,
    nodes,
    titles: NODE_TITLES,
    sub,
    tx,
    bulb,
    bulbLabel,
  };
}

/** The circuit on the Request page: the chosen strands and threshold, and the wallet's bulb. */
export function previewModel(
  oracles: Oracle[],
  selected: number[],
  threshold: number,
  bulbRead: BulbRead,
  names: ChainNames,
): CircuitModel {
  const dispute = leg(selected, threshold, "ready", [], "dispute");
  const ruling = leg(selected, threshold, "ready", [], "ruling");
  return {
    oracles: oracleList(oracles, selected),
    selected,
    threshold,
    dispute,
    ruling,
    nodes: { foreignOut: "idle", homeIn: "idle", court: "idle", homeOut: "idle", foreignIn: "idle" },
    titles: PREVIEW_NODE_TITLES,
    sub: nodeSubs(names, ""),
    tx: {},
    schematic: true,
    bulb: bulbRead.kind === "known" ? (bulbRead.on ? "on" : "off") : "unknown",
    bulbLabel:
      bulbRead.kind === "disconnected"
        ? ["Your bulb", "Connect a wallet to see its state"]
        : bulbRead.kind === "loading"
          ? ["Checking bulb…", `Looking it up on ${names.foreign} local devnet`]
          : bulbRead.kind === "failed"
            ? ["Couldn't read bulb state", `Could not read it on ${names.foreign} local devnet`]
            : [bulbRead.on ? "Your bulb is on" : "Your bulb is off", `Current bulb state on ${names.foreign} local devnet`],
  };
}
