// The lifecycle state machine: maps what the two chains say about one request to a `SwitchRequest`.
// Pure: chain.ts gathers the facts, this file decides the stage, the reports, the transactions and the steps due.
import type {
  Address,
  CreationStatus,
  FlowStage,
  Hex,
  OracleReport,
  OracleSelection,
  PayToken,
  Refund,
  RequestAction,
  StageTx,
  SwitchRequest,
} from "./types";

/** The path of a request the court opened and ruled on. */
export const STAGES: FlowStage[] = [
  "submitted",
  "dispute-relaying",
  "dispute-delivered",
  "dispute-received",
  "ruled",
  "ruling-relaying",
  "switched",
];

/** The path of a request the court could not open in time: the failure comes back and the juror fees are refunded. */
export const FAILURE_STAGES: FlowStage[] = [
  "submitted",
  "dispute-relaying",
  "dispute-delivered",
  "creation-failed",
  "failure-relaying",
  "closed",
];

const FAILURE_ONLY = new Set<FlowStage>(["creation-failed", "failure-relaying", "closed"]);

/**
 * The step of a stage, shared by both paths: the failure path has no step 3 (the court never opened the case), and
 * its later stages take the place of the ruling, its return and the bulb update.
 */
const STEP: Record<FlowStage, number> = {
  submitted: 0,
  "dispute-relaying": 1,
  "dispute-delivered": 2,
  "dispute-received": 3,
  ruled: 4,
  "creation-failed": 4,
  "ruling-relaying": 5,
  "failure-relaying": 5,
  switched: 6,
  closed: 6,
};

export const stageIndex = (stage: FlowStage) => STEP[stage];

/** True once the request took the creation-failure path. */
export function isFailurePath(request: Pick<SwitchRequest, "stage" | "txs">): boolean {
  if (request.stage !== "failed" && FAILURE_ONLY.has(request.stage)) return true;
  return request.txs.some((t) => FAILURE_ONLY.has(t.stage));
}

export const pathOf = (request: Pick<SwitchRequest, "stage" | "txs">) => (isFailurePath(request) ? FAILURE_STAGES : STAGES);

/** One oracle's report of a message on the target chain: the adapter stored the hash. */
export interface ReportFact {
  oracleId: number;
  txHash: Hex | null; // the storeHash transaction, null while pending
}

/** A dispatched message: the leg's oracles in message order and their reports. */
export interface LegFacts {
  messageId: bigint;
  dispatchTx: Hex; // the transaction that dispatched it (requestSwitch, executeRuling, sendCreationFailure)
  reports: ReportFact[]; // one per selected oracle, in selection order
  executedTx: Hex | null; // Yaru.executeMessages on the target chain
  failure: string | null; // decoded revert of a simulated execute once the threshold is met, else null
  executable: boolean; // the threshold is met, it is not executed and a simulated execute goes through
}

export interface RequestFacts {
  disputeId: bigint;
  owner: Address;
  selection: OracleSelection;
  paid: { token: PayToken; amount: bigint };
  requestTx: Hex;
  requestedAt: number; // ms, block time of the request
  dispute: LegFacts | null; // null only when the request transaction dispatched nothing
  // HomeGateway.getReceivedDispute(hash) once onMessage recorded it: receivedAt, and receivedAt + creationTimeout
  delivered: { at: number; failableAt: number } | null;
  created: { tx: Hex | null; homeDisputeId: bigint } | null; // createReceivedDispute ran (tx: CrossChainDisputeIncoming)
  creationBlocker: string | null; // while delivered and not created: why a simulated createReceivedDispute reverts
  creationFailure: { tx: Hex } | null; // DisputeCreationFailed on the home chain (sendCreationFailure)
  ruling: { value: bigint; tx: Hex } | null; // RulingDispatched on the home chain
  rulingLeg: LegFacts | null; // the return leg: the ruling's message, or the creation failure's
  switched: { tx: Hex } | null; // LightbulbSwitched for this dispute (ForeignGateway.executeRuling)
  closed: { tx: Hex } | null; // LightbulbRequestFailed for this dispute (ForeignGateway.executeRuling)
  refund: Refund | null; // from the ForeignGateway's DisputeCreationFailed and RefundClaimed
  refundPending: boolean; // ForeignGateway.pendingRefunds(disputeId) is set
  homeTime: number; // ms, the home chain's latest block time: the clock HomeGateway checks the creation window against
  updatedAt: number; // ms, when the facts were read
}

const asRuling = (value: bigint): 0 | 1 | 2 => (value === 1n ? 1 : value === 2n ? 2 : 0);

function legReports(leg: LegFacts | null, selection: OracleSelection, name: "dispute" | "ruling", failed: boolean) {
  return selection.oracleIds.map((oracleId): OracleReport => {
    const report = leg?.reports.find((r) => r.oracleId === oracleId);
    const status = report?.txHash ? "reported" : failed ? "failed" : "pending";
    return { oracleId, leg: name, status };
  });
}

function reportTxs(leg: LegFacts | null, stage: FlowStage, chain: StageTx["chain"], oracleName: (id: number) => string) {
  if (!leg) return [];
  return leg.reports
    .filter((r): r is ReportFact & { txHash: Hex } => r.txHash !== null)
    .map((r): StageTx => ({ stage, chain, label: `storeHash · ${oracleName(r.oracleId)}`, hash: r.txHash }));
}

/** The return leg (ruling or creation failure): relayed back, recorded on the foreign chain, then executed. */
function returnLeg(
  facts: RequestFacts,
  txs: StageTx[],
  relaying: FlowStage,
  done: FlowStage,
  executed: { tx: Hex } | null,
  oracleName: (id: number) => string,
): { stage: FlowStage | null; error: string | null } {
  const leg = facts.rulingLeg;
  if (!leg) return { stage: null, error: null };
  txs.push(...reportTxs(leg, relaying, "foreign", oracleName));
  if (!leg.executedTx) return { stage: relaying, error: leg.failure };
  txs.push({ stage: relaying, chain: "foreign", label: "executeMessages", hash: leg.executedTx });
  if (!executed) return { stage: relaying, error: null };
  txs.push({ stage: done, chain: "foreign", label: "executeRuling", hash: executed.tx });
  return { stage: done, error: null };
}

/** The request as the chains describe it now. */
export function buildRequest(facts: RequestFacts, oracleName: (id: number) => string = (id) => `oracle #${id}`): SwitchRequest {
  const txs: StageTx[] = [{ stage: "submitted", chain: "foreign", label: "requestSwitch", hash: facts.requestTx }];
  let stage: FlowStage = "submitted";
  let error: string | null = null;

  if (facts.dispute) {
    stage = "dispute-relaying";
    txs.push(...reportTxs(facts.dispute, "dispute-relaying", "home", oracleName));
  }
  if (facts.delivered && facts.dispute?.executedTx) {
    stage = "dispute-delivered";
    txs.push({ stage: "dispute-delivered", chain: "home", label: "executeMessages", hash: facts.dispute.executedTx });
  } else if (facts.dispute?.failure) {
    error = facts.dispute.failure;
  }

  if (stage === "dispute-delivered" && facts.created) {
    stage = "dispute-received";
    if (facts.created.tx) txs.push({ stage, chain: "home", label: "createReceivedDispute", hash: facts.created.tx });
    if (facts.ruling) {
      stage = "ruled";
      txs.push({ stage: "ruled", chain: "home", label: "executeRuling", hash: facts.ruling.tx });
      const back = returnLeg(facts, txs, "ruling-relaying", "switched", facts.switched, oracleName);
      if (back.stage) stage = back.stage;
      error = back.error;
    }
  } else if (stage === "dispute-delivered" && facts.creationFailure) {
    stage = "creation-failed";
    txs.push({ stage, chain: "home", label: "sendCreationFailure", hash: facts.creationFailure.tx });
    const back = returnLeg(facts, txs, "failure-relaying", "closed", facts.closed, oracleName);
    if (back.stage) stage = back.stage;
    error = back.error;
    if (stage === "closed" && facts.refund?.claimed) {
      txs.push({ stage: "closed", chain: "foreign", label: "claimRefund", hash: facts.refund.claimed.tx });
    }
  }

  const at = STEP[stage];
  const failurePath = FAILURE_ONLY.has(stage);
  let creation: CreationStatus | null = null;
  if (facts.delivered && at >= STEP["dispute-delivered"]) {
    const state = at >= STEP["dispute-received"] ? (failurePath ? "failed" : "created") : "waiting";
    creation = {
      state,
      deliveredAt: facts.delivered.at,
      failableAt: facts.delivered.failableAt,
      blocker: state === "waiting" ? facts.creationBlocker : null,
    };
  }

  const request: SwitchRequest = {
    disputeId: facts.disputeId,
    homeDisputeId: !failurePath && at >= STEP["dispute-received"] ? (facts.created?.homeDisputeId ?? null) : null,
    owner: facts.owner,
    selection: facts.selection,
    paid: facts.paid,
    stage: error ? "failed" : stage,
    ruling: facts.ruling && !failurePath && at >= STEP.ruled ? asRuling(facts.ruling.value) : 0,
    reports: [
      ...legReports(facts.dispute, facts.selection, "dispute", error !== null && stage === "dispute-relaying"),
      ...legReports(facts.rulingLeg, facts.selection, "ruling", error !== null && at === STEP["ruling-relaying"]),
    ],
    txs,
    error,
    creation,
    refund: stage === "closed" ? facts.refund : null,
    actions: [],
    updatedAt: facts.updatedAt,
  };
  request.actions = error ? [] : dueActions(facts, request);
  return request;
}

/** The steps any wallet can run now, in lifecycle order. */
function dueActions(facts: RequestFacts, request: SwitchRequest): RequestAction[] {
  const actions: RequestAction[] = [];
  const stage = request.stage;
  if (stage === "dispute-relaying" && facts.dispute?.executable) actions.push("deliver");
  if (request.creation?.state === "waiting") {
    if (request.creation.blocker === null) actions.push("create-dispute");
    if (facts.homeTime >= request.creation.failableAt) actions.push("send-failure");
  }
  if ((stage === "ruling-relaying" || stage === "failure-relaying") && facts.rulingLeg) {
    if (facts.rulingLeg.executable) actions.push("deliver-back");
    else if (facts.rulingLeg.executedTx) actions.push("execute-ruling");
  }
  if (stage === "closed" && facts.refundPending && request.refund && !request.refund.claimed) actions.push("claim-refund");
  return actions;
}

/** True once nothing more can happen to the request. */
export function isFinal(request: SwitchRequest): boolean {
  if (request.stage === "switched") return true;
  return request.stage === "closed" && (request.refund?.claimed != null || !request.actions.includes("claim-refund"));
}

/** The last stage reached: for a failed request, the stage it failed in. */
export function reachedStage(request: SwitchRequest): FlowStage {
  if (request.stage !== "failed") return request.stage;
  const last = request.txs[request.txs.length - 1]?.stage ?? "submitted";
  // A failure happens while a leg is relaying: the request is past the stage of its last transaction.
  if (last === "submitted" || last === "dispute-relaying") return "dispute-relaying";
  return isFailurePath(request) ? "failure-relaying" : "ruling-relaying";
}

/** The request as it was when it had just reached `stage`: later transactions, reports and fields removed. */
export function projectTo(request: SwitchRequest, stage: FlowStage): SwitchRequest {
  const at = STEP[stage];
  const creation: CreationStatus | null =
    request.creation && at >= STEP["dispute-delivered"]
      ? at === STEP["dispute-delivered"]
        ? { ...request.creation, state: "waiting", blocker: null }
        : request.creation
      : null;
  return {
    ...request,
    stage,
    error: null,
    homeDisputeId: at >= STEP["dispute-received"] ? request.homeDisputeId : null,
    ruling: at >= STEP.ruled ? request.ruling : 0,
    txs: request.txs.filter((tx) => STEP[tx.stage] <= at && !(tx.label === "claimRefund" && request.stage !== stage)),
    reports: request.reports.map((r) => {
      const legStage = r.leg === "dispute" ? "dispute-relaying" : "ruling-relaying";
      return STEP[legStage] <= at ? r : { ...r, status: "pending" as const };
    }),
    creation,
    refund: stage === "closed" ? request.refund : null,
    actions: stage === request.stage ? request.actions : [],
  };
}

/**
 * The snapshots to report when a watched request moves from `previous` to `next`: one per stage in between, in
 * order, so a listener sees every stage even when the chains moved several steps between two polls.
 */
export function stageSteps(previous: SwitchRequest | null, next: SwitchRequest): SwitchRequest[] {
  const path = pathOf(next);
  const position = (r: SwitchRequest) => path.indexOf(reachedStage(r));
  const from = previous ? position(previous) : -1;
  const to = position(next);
  const steps: SwitchRequest[] = [];
  // A failed request first shows the stage it failed in, then the failure.
  const end = next.stage === "failed" ? to + 1 : to;
  for (let i = from + 1; i < end; i++) steps.push(projectTo(next, path[i]));
  if (!previous || to > from || changed(previous, next)) steps.push(next);
  return steps;
}

function changed(a: SwitchRequest, b: SwitchRequest): boolean {
  return (
    a.stage !== b.stage ||
    a.error !== b.error ||
    a.txs.length !== b.txs.length ||
    a.reports.some((r, i) => r.status !== b.reports[i]?.status) ||
    a.creation?.state !== b.creation?.state ||
    a.creation?.blocker !== b.creation?.blocker ||
    a.refund?.claimed?.tx !== b.refund?.claimed?.tx ||
    a.actions.join() !== b.actions.join()
  );
}
