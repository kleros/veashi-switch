import type { FlowStage, Oracle, OracleReport, RequestAction, RequestStage, StageTx, SwitchRequest } from "../data";
import { isFailurePath, reachedStage } from "../data/lifecycle";
import type { ChainNames } from "./circuitModel";
import { splitMessage } from "./errors";
import { clockTime, rulingName, stageIndex } from "./format";
import type { BulbRead } from "./readState";

export type EntryState = "done" | "cur" | "todo" | "fail" | "skip";

export interface LogEntry {
  key: string;
  title: string;
  chain: "foreign" | "home";
  tech: string; // the contract calls behind the step: shown only under "Technical details"
  state: EntryState;
  word?: string; // the state's word when the default ("Paused" for fail) would mislead
  txs: StageTx[];
  report?: { leg: OracleReport["leg"]; oracleId: number; status: OracleReport["status"] | "none" };
}

export const STAGE_LABEL: Record<RequestStage, string> = {
  submitted: "Request sent",
  "dispute-relaying": "Delivering request",
  "dispute-delivered": "Opening the case",
  "dispute-received": "Court received",
  ruled: "Decision submitted",
  "ruling-relaying": "Decision returning",
  switched: "Bulb updated",
  "creation-failed": "Case not opened",
  "failure-relaying": "Case not opened",
  closed: "Closed · refund",
  failed: "Delivery paused",
};

const TX_LABEL: Record<FlowStage, string> = {
  submitted: "Request",
  "dispute-relaying": "Oracle report",
  "dispute-delivered": "Delivery",
  "dispute-received": "Court case",
  ruled: "Court decision",
  "ruling-relaying": "Oracle report",
  switched: "Bulb update",
  "creation-failed": "Failure sent",
  "failure-relaying": "Oracle report",
  closed: "Request closed",
};

/** A plain name for a step's transaction; the contract call itself stays under "Technical details". */
export const txName = (t: StageTx) =>
  t.label === "executeMessages" ? "Delivery" : t.label === "claimRefund" ? "Refund claim" : TX_LABEL[t.stage];

/** The step a request has reached, 0 to 6 (for a paused one, the step it paused in). */
export const reachedStep = (req: SwitchRequest) => stageIndex(reachedStage(req));

/** True while the delivered dispute waits for the court and its creation window has closed. */
const windowClosed = (req: SwitchRequest) => req.actions.includes("send-failure");

/** The event log of a request: its stages in order (the path it took), each leg followed by one row per oracle. */
export function logEntries(req: SwitchRequest, oracles: Oracle[], names: ChainNames): LogEntry[] {
  const paused = req.stage === "failed";
  const failurePath = isFailurePath(req);
  const s = reachedStep(req);
  const k = req.selection.threshold;
  const txs = (stage: FlowStage) => req.txs.filter((t) => t.stage === stage);
  const name = (id: number) => oracles.find((o) => o.id === id)?.name ?? `Oracle ${id}`;
  // A plain stage: done once reached; the next one is in progress (or paused when the request failed).
  // (After a relaying leg the next stage waits for the oracles, so it is not in progress yet.)
  const stageState = (i: number): EntryState =>
    i <= s ? "done" : i === s + 1 && s !== 1 && s !== 5 ? (paused ? "fail" : "cur") : "todo";
  // A relaying leg: in progress while the request sits on it or just before it.
  const legState = (i: number): EntryState => {
    if (s > i) return "done";
    if (s === i || s === i - 1) return paused && s === i ? "fail" : paused ? "todo" : "cur";
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
              : s >= i - 1 && !paused
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
  const returnLeg = req.reports.filter((r) => r.leg === "ruling" && r.status === "reported").length;
  const home = req.homeDisputeId !== null ? ` #${req.homeDisputeId.toString()}` : "";
  const blocked = req.creation?.state === "waiting" && req.creation.blocker !== null;

  const opening: LogEntry = failurePath
    ? {
        key: "dispute-received",
        title: "Court did not open the case in time",
        chain: "home",
        tech: "HomeGateway.createReceivedDispute never went through before the creation window closed",
        state: "fail",
        word: "Not opened",
        txs: [],
      }
    : {
        key: "dispute-received",
        title:
          s >= 3
            ? `Court opened the case · Court case${home}`
            : windowClosed(req)
              ? "Court did not open the case in time"
              : blocked
                ? "Court cannot open the case yet"
                : "Court opens the case",
        chain: "home",
        tech: "HomeGateway.createReceivedDispute → KlerosCoreRuler.createDispute (anyone can call it; retried while it reverts)",
        state: s < 3 && (blocked || windowClosed(req)) ? "fail" : stageState(3),
        word: s < 3 && windowClosed(req) ? "Window closed" : s < 3 && blocked ? "Waiting" : undefined,
        txs: txs("dispute-received"),
      };

  const start: LogEntry[] = [
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
      key: "dispute-delivered",
      title: s >= 2 ? `Request delivered to ${names.home}` : `Request reaches ${names.home}`,
      chain: "home",
      tech: "Yaru.executeMessages → HomeGateway.onMessage (records the dispute; it does not call the court)",
      state: stageState(2),
      txs: txs("dispute-delivered"),
    },
    opening,
  ];

  if (failurePath) {
    const claimed = req.refund?.claimed != null;
    return [
      ...start,
      {
        key: "creation-failed",
        title: "Failure sent back · creation window closed",
        chain: "home",
        tech: "HomeGateway.sendCreationFailure (anyone, once the creation window has passed) → dispatch to the same oracles",
        state: stageState(4),
        txs: txs("creation-failed"),
      },
      {
        key: "failure-relaying",
        title: `Failure returns to ${names.foreign} · ${returnLeg} reported · ${k} required`,
        chain: "foreign",
        tech: "the creation failure travels back over the dispute's oracles",
        state: legState(5),
        txs: txs("failure-relaying"),
      },
      ...reports("ruling", 5),
      {
        key: "closed",
        title: s >= 6 ? (claimed ? "Request closed · juror fees refunded" : "Request closed · refund available") : "Request closes",
        chain: "foreign",
        tech: `ForeignGateway.executeRuling → GatewayLightbulb.onDisputeCreationFailed(${req.disputeId.toString()}); LightbulbRequestFailed; claimRefund pays the juror fees to the requester`,
        state: stageState(6),
        txs: txs("closed"),
      },
    ];
  }

  return [
    ...start,
    {
      key: "ruled",
      title: s >= 4 ? `Court decided ${rulingName(req.ruling)}` : "Court decision",
      chain: "home",
      tech: `KlerosCoreRuler ruling (manual mode); ruling code ${req.ruling}`,
      state: stageState(4),
      txs: txs("ruled"),
    },
    {
      key: "ruling-relaying",
      title: `Decision returns to ${names.foreign} · ${returnLeg} reported · ${k} required`,
      chain: "foreign",
      tech: "HomeGateway.rule → dispatch to the same oracles",
      state: legState(5),
      txs: txs("ruling-relaying"),
    },
    ...reports("ruling", 5),
    {
      key: "switched",
      title: s >= 6 && !paused ? `Bulb updated · set ${rulingName(req.ruling)} by this decision` : "Bulb updates",
      chain: "foreign",
      tech: `ForeignGateway.executeRuling → GatewayLightbulb.rule(${req.disputeId.toString()}, ${req.ruling || "…"}); LightbulbSwitched`,
      state: stageState(6),
      txs: txs("switched"),
    },
  ];
}

/** A step any wallet can run, worded for the page: the button, what it does, and the chain it runs on. */
export interface ActionModel {
  action: RequestAction;
  label: string;
  note: string;
  chain: "foreign" | "home";
}

/**
 * The steps to offer as buttons. On a testnet every due step is offered (no relay service may be running); on the
 * devnet the relay service runs the deliveries, the case creation and the ruling, so only the two steps it leaves
 * to people are: sending the failure back and claiming the refund.
 */
export function actionModels(
  req: SwitchRequest,
  names: ChainNames,
  opts: { selfServe: boolean; amount?: (value: bigint) => string },
): ActionModel[] {
  const amount = req.refund && opts.amount ? opts.amount(req.refund.amount) : null;
  const failurePath = isFailurePath(req);
  const copy: Record<RequestAction, Omit<ActionModel, "action">> = {
    deliver: {
      label: `Deliver to ${names.home}`,
      note: `Enough oracles agree. Anyone can run the delivery on ${names.home}.`,
      chain: "home",
    },
    "create-dispute": {
      label: "Open the court case",
      note: `The request is on ${names.home}. Anyone can open its case on the court.`,
      chain: "home",
    },
    "send-failure": {
      label: "Send the failure back",
      note: `Tells ${names.foreign} that the case was not opened, so the request closes and the juror fees are refunded. Anyone can send it once the creation window has closed.`,
      chain: "home",
    },
    "deliver-back": {
      label: `Deliver to ${names.foreign}`,
      note: `Enough oracles agree. Anyone can run the delivery on ${names.foreign}.`,
      chain: "foreign",
    },
    "execute-ruling": failurePath
      ? {
          label: "Close the request",
          note: `The failure is on ${names.foreign}. Anyone can close the request; the juror fees then become claimable.`,
          chain: "foreign",
        }
      : {
          label: "Update the bulb",
          note: `The decision is on ${names.foreign}. Anyone can apply it to the bulb.`,
          chain: "foreign",
        },
    "claim-refund": {
      label: amount ? `Claim refund · ${amount}` : "Claim refund",
      note: "Pays the juror fees back to the requester. Anyone can send it.",
      chain: "foreign",
    },
  };
  const people: RequestAction[] = ["send-failure", "claim-refund"];
  return req.actions
    .filter((a) => opts.selfServe || people.includes(a))
    .map((action) => ({ action, ...copy[action] }));
}

export interface NowModel {
  title: string;
  body: string;
  status: "live" | "ok" | "warn" | "err";
  statusText: string;
  next: string; // who or what comes next, in plain words
  counts: string | null; // agreement counts of the leg in progress
  action: "simulate" | "done" | null;
  /** The requester's current bulb, apart from this request's outcome (completed or closed requests only). */
  bulbNow: { label: string; value: string; differs: string | null; retry: boolean } | null;
}

export const DECISION_SUBMITTED = "Decision submitted. Waiting for return delivery…";

/** The status panel: where the request is, what happens next and who acts. */
export function nowModel(
  req: SwitchRequest,
  oracles: Oracle[],
  names: ChainNames,
  opts: { canSimulate: boolean; bulb?: BulbRead; mine?: boolean; amount?: (value: bigint) => string },
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
  const bulbNow = (differs: string | null): NowModel["bulbNow"] => ({
    label: opts.mine ? "Your bulb now" : "Requester's bulb now",
    value: bulb.kind === "known" ? (bulb.on ? "On" : "Off") : bulb.kind === "failed" ? "Current bulb state unavailable" : "Checking bulb…",
    differs,
    retry: bulb.kind === "failed",
  });
  const refund = req.refund && opts.amount ? opts.amount(req.refund.amount) : "The juror fees";
  const relay = names.testnet ? "Anyone, or an automatic relay service" : "Automatic relay service";
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
        next: req.actions.includes("deliver") ? `Delivery on ${names.home}: ${relay}` : `Oracles: ${pendingOracles("dispute")}`,
        counts: `${reported("dispute")} reported · ${k} required`,
        action: null,
        bulbNow: null,
      };
    case "dispute-delivered": {
      const creation = req.creation;
      const blocker = creation?.blocker ? splitMessage(creation.blocker).head : null;
      if (windowClosed(req))
        return {
          title: "The court did not open the case in time",
          body: `${blocker ? `${blocker} ` : ""}The creation window has closed, so the request can be ended: sending the failure back returns the juror fees to the requester. The bridging fees are kept, since both legs were used. The bulb does not change.`,
          status: "err",
          statusText: "Case not opened",
          next: "Anyone: send the failure back",
          counts: null,
          action: null,
          bulbNow: null,
        };
      const until = creation ? clockTime(creation.failableAt) : "the end of the creation window";
      if (blocker)
        return {
          title: `Delivered to ${names.home} · the court cannot open the case yet`,
          body: `${blocker} If the case is still not open at ${until}, anyone can end the request and the juror fees are refunded.`,
          status: "warn",
          statusText: "Waiting to open the case",
          next: names.testnet ? "Anyone can open it once the cause is fixed" : "Opens automatically once the cause is fixed",
          counts: null,
          action: null,
          bulbNow: null,
        };
      return {
        title: `Delivered to ${names.home} · opening the court case`,
        body: names.testnet
          ? "The case opens on the court as soon as someone runs this step."
          : "The automatic relay service opens the case on the court.",
        status: "live",
        statusText: "Opening the case",
        next: relay,
        counts: null,
        action: null,
        bulbNow: null,
      };
    }
    case "dispute-received":
      return opts.canSimulate
        ? {
            title: "Your turn: simulate the court decision",
            body: "Choose the court's decision for this local demo.",
            status: "live",
            statusText: "Awaiting your decision",
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
        body: `The court decided ${rulingName(req.ruling)}. The return delivery starts.`,
        status: "live",
        statusText: "Decision submitted",
        next: relay,
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
        next:
          req.actions.includes("deliver-back") || req.actions.includes("execute-ruling")
            ? `Bulb update on ${names.foreign}: ${relay}`
            : `Oracles: ${pendingOracles("ruling")}`,
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
        next: bulb.kind === "failed" ? "Retry the bulb check." : bulb.kind === "known" ? "No further action needed." : "Checking the bulb",
        counts: null,
        action: "done",
        bulbNow: bulbNow(
          bulb.kind === "known" && bulb.on !== (req.ruling === 1) ? "The current state differs from this request's result." : null,
        ),
      };
    case "creation-failed":
    case "failure-relaying":
      return {
        title: `Case not opened · the failure is returning to ${names.foreign}`,
        body: `The court did not open the case within the creation window. The failure crosses back over the same oracles; then the juror fees can be claimed back. The bulb does not change.`,
        status: "err",
        statusText: "Case not opened",
        next:
          req.actions.includes("deliver-back") || req.actions.includes("execute-ruling")
            ? `Closing the request on ${names.foreign}: ${relay}`
            : `Oracles: ${pendingOracles("ruling")}`,
        counts: `${reported("ruling")} reported · ${k} required`,
        action: null,
        bulbNow: null,
      };
    case "closed": {
      const claimed = req.refund?.claimed;
      return claimed
        ? {
            title: "Request closed · juror fees refunded",
            body: `The court did not open the case, so the bulb did not change. ${refund} went back to the requester; the bridging fees were kept.`,
            status: "warn",
            statusText: "Closed · refunded",
            next: "No further action needed.",
            counts: null,
            action: "done",
            bulbNow: bulbNow(null),
          }
        : {
            title: "Request closed · refund available",
            body: `The court did not open the case, so the bulb did not change. ${refund} in juror fees can be claimed back to the requester; the bridging fees are kept.`,
            status: "warn",
            statusText: "Closed · refund available",
            next: req.actions.includes("claim-refund") ? "Anyone: claim the refund for the requester" : "Refund pending",
            counts: null,
            action: null,
            bulbNow: bulbNow(null),
          };
    }
    case "failed":
      return {
        title: "Request paid; delivery paused",
        body: splitMessage(req.error ?? "").head || "A delivery step did not complete.",
        status: "err",
        statusText: "Delivery paused",
        next: names.testnet ? "The network's operator" : "A local operator",
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
export function pausedModel(req: SwitchRequest, names?: ChainNames): PausedModel {
  const failurePath = isFailurePath(req);
  const s = reachedStep(req);
  const lastStep = [
    "Request sent",
    "Oracles delivering the request",
    "Request delivered",
    "Court opened the case",
    failurePath ? "Failure sent back" : "Court decision submitted",
    failurePath ? "Failure returning" : "Decision returning",
    failurePath ? "Request closed" : "Bulb updated",
  ][Math.min(s, 6)];
  const { head, detail } = splitMessage(req.error ?? "");
  const operator = names?.testnet ? "The network's operator" : "A local operator";
  return {
    title: "Request paid; delivery paused",
    lastStep,
    message: head || "A delivery step did not complete.",
    // the chain's plain first paragraph (the status body) names the cause and the action once; this line only adds what it does not say
    operatorAction: head ? "Once that is resolved, use Refresh status." : `${operator} needs to check the network, then retry delivery.`,
    warning: "This request is already paid. Do not create a duplicate request.",
    detail: detail ?? (req.error && req.error !== head ? req.error : null),
  };
}
