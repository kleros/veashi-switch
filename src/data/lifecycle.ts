// The lifecycle state machine: maps what the two chains say about one request to a `SwitchRequest`.
// Pure: chain.ts gathers the facts, this file decides the stage, the reports and the transactions.
import type { Address, Hex, OracleReport, OracleSelection, PayToken, RequestStage, StageTx, SwitchRequest } from "./types";

export const STAGES: Exclude<RequestStage, "failed">[] = [
  "submitted",
  "dispute-relaying",
  "dispute-received",
  "ruled",
  "ruling-relaying",
  "switched",
];

export const stageIndex = (stage: Exclude<RequestStage, "failed">) => STAGES.indexOf(stage);

/** One oracle's report of a message on the target chain: the adapter stored the hash. */
export interface ReportFact {
  oracleId: number;
  txHash: Hex | null; // the storeHash transaction, null while pending
}

/** A dispatched message: the leg's oracles in message order and their reports. */
export interface LegFacts {
  messageId: bigint;
  dispatchTx: Hex; // the transaction that dispatched it (requestSwitch, executeRuling)
  reports: ReportFact[]; // one per selected oracle, in selection order
  executedTx: Hex | null; // Yaru.executeMessages on the target chain
  failure: string | null; // decoded revert of a simulated execute once the threshold is met, else null
}

export interface RequestFacts {
  disputeId: bigint;
  owner: Address;
  selection: OracleSelection;
  paid: { token: PayToken; amount: bigint };
  requestTx: Hex;
  requestedAt: number; // ms, block time of the request
  dispute: LegFacts | null; // null only when the request transaction dispatched nothing
  homeDisputeId: bigint | null; // from HomeGateway once getReceivedDispute(hash).received
  received: boolean;
  ruling: { value: bigint; tx: Hex } | null; // RulingDispatched on the home chain
  rulingLeg: LegFacts | null;
  switched: { tx: Hex } | null; // LightbulbSwitched for this dispute
  updatedAt: number;
}

const asRuling = (value: bigint): 0 | 1 | 2 => (value === 1n ? 1 : value === 2n ? 2 : 0);

function legReports(leg: LegFacts | null, selection: OracleSelection, name: "dispute" | "ruling", failed: boolean) {
  return selection.oracleIds.map((oracleId): OracleReport => {
    const report = leg?.reports.find((r) => r.oracleId === oracleId);
    const status = report?.txHash ? "reported" : failed ? "failed" : "pending";
    return { oracleId, leg: name, status };
  });
}

function reportTxs(leg: LegFacts | null, stage: StageTx["stage"], chain: StageTx["chain"], oracleName: (id: number) => string) {
  if (!leg) return [];
  return leg.reports
    .filter((r): r is ReportFact & { txHash: Hex } => r.txHash !== null)
    .map((r): StageTx => ({ stage, chain, label: `storeHash · ${oracleName(r.oracleId)}`, hash: r.txHash }));
}

/** The request as the chains describe it now. */
export function buildRequest(facts: RequestFacts, oracleName: (id: number) => string = (id) => `oracle #${id}`): SwitchRequest {
  const txs: StageTx[] = [{ stage: "submitted", chain: "foreign", label: "requestSwitch", hash: facts.requestTx }];
  let stage: RequestStage = "submitted";
  let error: string | null = null;

  if (facts.dispute) {
    stage = "dispute-relaying";
    txs.push(...reportTxs(facts.dispute, "dispute-relaying", "home", oracleName));
  }
  if (facts.received && facts.dispute?.executedTx) {
    stage = "dispute-received";
    txs.push({ stage: "dispute-received", chain: "home", label: "executeMessages", hash: facts.dispute.executedTx });
  } else if (facts.dispute?.failure) {
    error = facts.dispute.failure;
  }
  if (stage === "dispute-received" && facts.ruling) {
    stage = "ruled";
    txs.push({ stage: "ruled", chain: "home", label: "executeRuling", hash: facts.ruling.tx });
    if (facts.rulingLeg) {
      stage = "ruling-relaying";
      txs.push(...reportTxs(facts.rulingLeg, "ruling-relaying", "foreign", oracleName));
      if (facts.switched && facts.rulingLeg.executedTx) {
        stage = "switched";
        txs.push({ stage: "switched", chain: "foreign", label: "executeMessages", hash: facts.rulingLeg.executedTx });
      } else if (facts.rulingLeg.failure) {
        error = facts.rulingLeg.failure;
      }
    }
  }

  const disputeFailed = error !== null && stage === "dispute-relaying";
  const rulingFailed = error !== null && stage === "ruling-relaying";
  return {
    disputeId: facts.disputeId,
    homeDisputeId: stageIndexOf(stage) >= stageIndex("dispute-received") ? facts.homeDisputeId : null,
    owner: facts.owner,
    selection: facts.selection,
    paid: facts.paid,
    stage: error ? "failed" : stage,
    ruling: facts.ruling && stageIndexOf(stage) >= stageIndex("ruled") ? asRuling(facts.ruling.value) : 0,
    reports: [
      ...legReports(facts.dispute, facts.selection, "dispute", disputeFailed),
      ...legReports(facts.rulingLeg, facts.selection, "ruling", rulingFailed),
    ],
    txs,
    error,
    updatedAt: facts.updatedAt,
  };
}

/** The last stage reached: for a failed request, the stage it failed in. */
export function reachedStage(request: SwitchRequest): Exclude<RequestStage, "failed"> {
  if (request.stage !== "failed") return request.stage;
  const last = request.txs[request.txs.length - 1]?.stage ?? "submitted";
  // A failure happens while a leg is relaying: the request is past the stage of its last transaction.
  if (last === "submitted" || last === "dispute-relaying") return "dispute-relaying";
  return "ruling-relaying";
}

function stageIndexOf(stage: RequestStage): number {
  return stage === "failed" ? -1 : stageIndex(stage);
}

/** The request as it was when it had just reached `stage`: later transactions, reports and fields removed. */
export function projectTo(request: SwitchRequest, stage: Exclude<RequestStage, "failed">): SwitchRequest {
  const at = stageIndex(stage);
  return {
    ...request,
    stage,
    error: null,
    homeDisputeId: at >= stageIndex("dispute-received") ? request.homeDisputeId : null,
    ruling: at >= stageIndex("ruled") ? request.ruling : 0,
    txs: request.txs.filter((tx) => stageIndex(tx.stage) <= at),
    reports: request.reports.map((r) => {
      const legStage = r.leg === "dispute" ? "dispute-relaying" : "ruling-relaying";
      return stageIndex(legStage) <= at ? r : { ...r, status: "pending" as const };
    }),
  };
}

/**
 * The snapshots to report when a watched request moves from `previous` to `next`: one per stage in between, in
 * order, so a listener sees every stage even when the chains moved several steps between two polls.
 */
export function stageSteps(previous: SwitchRequest | null, next: SwitchRequest): SwitchRequest[] {
  const from = previous ? stageIndex(reachedStage(previous)) : -1;
  const to = stageIndex(reachedStage(next));
  const steps: SwitchRequest[] = [];
  // A failed request first shows the stage it failed in, then the failure.
  const end = next.stage === "failed" ? to + 1 : to;
  for (let i = from + 1; i < end; i++) steps.push(projectTo(next, STAGES[i]));
  if (!previous || to > from || changed(previous, next)) steps.push(next);
  return steps;
}

function changed(a: SwitchRequest, b: SwitchRequest): boolean {
  return (
    a.stage !== b.stage ||
    a.error !== b.error ||
    a.txs.length !== b.txs.length ||
    a.reports.some((r, i) => r.status !== b.reports[i]?.status)
  );
}
