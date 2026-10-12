import type { Oracle, OracleReport, RequestStage, StageTx, SwitchRequest } from "../data";
import { reachedStage, type ChainNames } from "./circuitModel";
import { splitMessage } from "./errors";
import { rulingName, stageIndex } from "./format";
import type { BulbRead } from "./readState";

export type EntryState = "done" | "cur" | "todo" | "fail" | "skip";

export interface LogEntry {
  key: string;
  title: string;
  chain: "foreign" | "home";
  tech: string; // the contract calls behind the step: shown only under "Technical details"
  state: EntryState;
  txs: StageTx[];
  report?: { leg: OracleReport["leg"]; oracleId: number; status: OracleReport["status"] | "none" };
}

export const STAGE_LABEL: Record<RequestStage, string> = {
  submitted: "Request sent",
  "dispute-relaying": "Delivering request",
  "dispute-received": "Court received",
  ruled: "Decision submitted",
  "ruling-relaying": "Decision returning",
  switched: "Bulb updated",
  failed: "Delivery paused",
};

const TX_LABEL: Record<Exclude<RequestStage, "failed">, string> = {
  submitted: "Request",
  "dispute-relaying": "Oracle report",
  "dispute-received": "Court delivery",
  ruled: "Court decision",
  "ruling-relaying": "Oracle report",
  switched: "Bulb update",
};

/** A plain name for a step's transaction; the contract call itself stays under "Technical details". */
export const txName = (t: StageTx) => TX_LABEL[t.stage];

/** The event log of a request: its six stages in order, each leg followed by one row per selected oracle. */
export function logEntries(req: SwitchRequest, oracles: Oracle[], names: ChainNames): LogEntry[] {
  const failed = req.stage === "failed";
  const s = failed ? reachedStage(req) : stageIndex(req.stage);
  const k = req.selection.threshold;
  const txs = (stage: RequestStage) => req.txs.filter((t) => t.stage === stage);
  const name = (id: number) => oracles.find((o) => o.id === id)?.name ?? `Oracle ${id}`;
  // A plain stage: done once reached; the next one is in progress (or paused when the request failed).
  // (After a relaying leg the next stage waits for the oracles, so it is not in progress yet.)
  const stageState = (i: number): EntryState =>
    i <= s ? "done" : i === s + 1 && s !== 1 && s !== 4 ? (failed ? "fail" : "cur") : "todo";
  // A relaying leg: in progress while the request sits on it or just before it.
  const legState = (i: number): EntryState => {
    if (s > i) return "done";
    if (s === i || s === i - 1) return failed && s === i ? "fail" : failed ? "todo" : "cur";
    return "todo";
  };
  const reports = (leg: OracleReport["leg"], i: number): LogEntry[] =>
    req.selection.oracleIds.map((id) => {
      const r = req.reports.find((x) => x.leg === leg && x.oracleId === id);
      const status = r?.status ?? "none";
      const legDone = s > i;
      const state: EntryState =
        status === "reported"
          ? "done"
          : status === "failed"
            ? "fail"
            : legDone
              ? "skip"
              : s >= i - 1 && !failed
                ? "cur"
                : "todo";
      const where = leg === "dispute" ? names.home : names.foreign;
      return {
        key: `report-${leg}-${id}`,
        title:
          status === "reported"
            ? `${name(id)} reported`
            : status === "failed"
              ? `${name(id)} could not report`
              : state === "skip"
                ? `${name(id)} not needed, agreement already reached`
                : state === "cur"
                  ? `${name(id)} reporting…`
                  : `${name(id)} will report`,
        chain: leg === "dispute" ? "home" : "foreign",
        tech: `${name(id)} oracle ${id}: stores the message hash on ${where}`,
        state,
        txs: [],
        report: { leg, oracleId: id, status },
      };
    });
  const disputeLeg = req.reports.filter((r) => r.leg === "dispute" && r.status === "reported").length;
  const rulingLeg = req.reports.filter((r) => r.leg === "ruling" && r.status === "reported").length;
  const home = req.homeDisputeId !== null ? ` #${req.homeDisputeId.toString()}` : "";
  return [
    {
      key: "submitted",
      title: "Request sent",
      chain: "foreign",
      tech: "GatewayLightbulb.requestSwitch → ForeignGateway.createDispute + relay",
      state: "done",
      txs: txs("submitted"),
    },
    {
      key: "dispute-relaying",
      title: `Oracles deliver the request · ${disputeLeg} reported · ${k} required`,
      chain: "home",
      tech: `dispatched to ${req.selection.oracleIds.length} oracles; runs once ${k} report it`,
      state: legState(1),
      txs: txs("dispute-relaying"),
    },
    ...reports("dispute", 1),
    {
      key: "dispute-received",
      title: s >= 2 ? `Court received the request · Court case${home}` : "Court receives the request",
      chain: "home",
      tech: "Yaru.executeMessages → HomeGateway.onMessage → KlerosCoreRuler.createDispute",
      state: stageState(2),
      txs: txs("dispute-received"),
    },
    {
      key: "ruled",
      title: s >= 3 ? `Court decided ${rulingName(req.ruling)}` : "Court decision",
      chain: "home",
      tech: `KlerosCoreRuler ruling (manual on the devnet); ruling code ${req.ruling}`,
      state: stageState(3),
      txs: txs("ruled"),
    },
    {
      key: "ruling-relaying",
      title: `Decision returns to ${names.foreign} · ${rulingLeg} reported · ${k} required`,
      chain: "foreign",
      tech: "HomeGateway.rule → dispatch to the same oracles",
      state: legState(4),
      txs: txs("ruling-relaying"),
    },
    ...reports("ruling", 4),
    {
      key: "switched",
      title: s >= 5 && !failed ? `Bulb updated · set ${rulingName(req.ruling)} by this decision` : "Bulb updates",
      chain: "foreign",
      tech: `Yaru.executeMessages → ForeignGateway.onMessage → GatewayLightbulb.rule(${req.disputeId.toString()}, ${req.ruling || "…"}); LightbulbSwitched`,
      state: stageState(5),
      txs: txs("switched"),
    },
  ];
}

export interface NowModel {
  title: string;
  body: string;
  status: "live" | "ok" | "err";
  statusText: string;
  next: string; // who or what comes next, in plain words
  counts: string | null; // agreement counts of the leg in progress
  action: "simulate" | "done" | null;
  /** The requester's current bulb, apart from this request's outcome (completed requests only). */
  bulbNow: { label: string; value: string; differs: string | null; retry: boolean } | null;
}

export const DECISION_SUBMITTED = "Decision submitted. Waiting for return delivery…";

/** The status panel: where the request is, what happens next and who acts. */
export function nowModel(
  req: SwitchRequest,
  oracles: Oracle[],
  names: ChainNames,
  opts: { canSimulate: boolean; bulb?: BulbRead; mine?: boolean },
): NowModel {
  const k = req.selection.threshold;
  const name = (id: number) => oracles.find((o) => o.id === id)?.name ?? `Oracle ${id}`;
  const pendingOracles = (leg: OracleReport["leg"]) =>
    req.selection.oracleIds
      .filter((id) => !req.reports.some((r) => r.leg === leg && r.oracleId === id && r.status === "reported"))
      .map(name)
      .join(", ") || "the oracles";
  const home = req.homeDisputeId !== null ? `#${req.homeDisputeId.toString()}` : "";
  const reported = (leg: OracleReport["leg"]) =>
    req.reports.filter((r) => r.leg === leg && r.status === "reported").length;
  const bulb: BulbRead = opts.bulb ?? { kind: "loading" };
  switch (req.stage) {
    case "submitted":
      return {
        title: `On its way to ${names.home}`,
        body: `The oracles report it on ${names.home}. The court receives it once ${k} of them agree.`,
        status: "live",
        statusText: "In progress",
        next: `Oracles: ${pendingOracles("dispute")}`,
        counts: `${reported("dispute")} reported · ${k} required`,
        action: null,
        bulbNow: null,
      };
    case "dispute-relaying":
      return {
        title: `Delivering the request to ${names.home}`,
        body: `The court receives it once ${k} oracles report the same message.`,
        status: "live",
        statusText: "In progress",
        next: `Oracles: ${pendingOracles("dispute")}`,
        counts: `${reported("dispute")} reported · ${k} required`,
        action: null,
        bulbNow: null,
      };
    case "dispute-received":
      return opts.canSimulate
        ? {
            title: "Your turn: simulate the court decision",
            body: "Choose the court's decision for this local demo.",
            status: "live",
            statusText: "Local demo",
            next: "You: choose Decide On or Decide Off",
            counts: null,
            action: "simulate",
            bulbNow: null,
          }
        : {
            title: `Your request is in court · Court case ${home}`,
            body: "The court decides. This page updates when the decision is made.",
            status: "live",
            statusText: "In court",
            next: "The court",
            counts: null,
            action: null,
            bulbNow: null,
          };
    case "ruled":
      return {
        title: DECISION_SUBMITTED,
        body: `The court decided ${rulingName(req.ruling)}. The automatic relay service starts the return delivery.`,
        status: "live",
        statusText: "Decision submitted",
        next: "Automatic return delivery",
        counts: null,
        action: null,
        bulbNow: null,
      };
    case "ruling-relaying":
      return {
        title: DECISION_SUBMITTED,
        body: `The bulb on ${names.foreign} changes once ${k} oracles report the decision, ${rulingName(req.ruling)}.`,
        status: "live",
        statusText: "In progress",
        next: `Oracles: ${pendingOracles("ruling")}`,
        counts: `${reported("ruling")} reported · ${k} required`,
        action: null,
        bulbNow: null,
      };
    case "switched":
      return {
        title: `Request complete · bulb set ${rulingName(req.ruling)}`,
        body: `The court decided ${rulingName(req.ruling)} in Court case ${home} and the decision reached ${names.foreign}.`,
        status: "ok",
        statusText: `Decision: ${rulingName(req.ruling)}`,
        next: bulb.kind === "failed" ? "Retry the bulb check." : bulb.kind === "known" ? "Nothing. Done." : "Checking the bulb",
        counts: null,
        action: "done",
        bulbNow: {
          label: opts.mine ? "Your bulb now" : "Requester's bulb now",
          value:
            bulb.kind === "known" ? (bulb.on ? "On" : "Off") : bulb.kind === "failed" ? "Current bulb state unavailable" : "Checking bulb…",
          differs:
            bulb.kind === "known" && bulb.on !== (req.ruling === 1) ? "The current state differs from this request's result." : null,
          retry: bulb.kind === "failed",
        },
      };
    case "failed":
      return {
        title: "Request paid; delivery paused",
        body: splitMessage(req.error ?? "").head || "A delivery step did not complete.",
        status: "err",
        statusText: "Delivery paused",
        next: "A local operator",
        counts: null,
        action: null,
        bulbNow: null,
      };
  }
}

export interface PausedModel {
  title: string;
  lastStep: string;
  message: string;
  operatorAction: string;
  warning: string;
  detail: string | null;
}

/** "Request paid; delivery paused": the last step that worked, the operator action and the duplicate warning. */
export function pausedModel(req: SwitchRequest, _names?: ChainNames): PausedModel {
  const s = reachedStage(req);
  const lastStep = [
    "Request sent",
    "Oracles delivering the request",
    "Court received the request",
    "Court decision submitted",
    "Decision returning",
    "Bulb updated",
  ][Math.min(s, 5)];
  const { head, detail } = splitMessage(req.error ?? "");
  return {
    title: "Request paid; delivery paused",
    lastStep,
    message: head || "A delivery step did not complete.",
    // the chain's plain first paragraph (the status body) names the cause and the action once; this line only adds what it does not say
    operatorAction: head ? "When that is done, use Refresh status." : "A local operator needs to check the local network, then retry delivery.",
    warning: "This request is already paid. Do not create a duplicate request.",
    detail: detail ?? (req.error && req.error !== head ? req.error : null),
  };
}
