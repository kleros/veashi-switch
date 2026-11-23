// The seam between the data layer (src/data implements it) and the pages (they render it): change it on both sides.
// Field names follow the gateways and lightbulb in the kleros-v2 submodule (its contracts/src/gateway).

export type Hex = `0x${string}`;
export type Address = Hex;

export type ChainKey = "foreign" | "home"; // foreign = Base-like devnet chain, home = Arbitrum-like devnet chain

export interface ChainInfo {
  key: ChainKey;
  network: "devnet" | "testnet"; // the local anvil devnet, or a public testnet
  id: number;
  name: string; // shown in the UI, e.g. "Base-like" on the devnet, "Base Sepolia" on the testnet
  rpcUrl: string; // a local anvil URL on the devnet, a public RPC on a testnet
  explorerTxUrl: ((hash: Hex) => string) | null; // null on the devnet: the UI shows the hash, copyable, without a link
}

export interface Oracle {
  id: number; // the same oracle ID on both gateways (addOracle)
  name: string; // "Vea", "CCIP", "LayerZero", "deBridge"
  via: string; // reporter · adapter names, e.g. "VeaReporter · VeaAdapter"
  enabled: boolean; // ForeignGateway.setOracleEnabled
  bridgingCostWei: bigint; // ForeignGateway oracle bridging cost (both legs)
}

export interface OracleSelection {
  oracleIds: number[]; // sorted, distinct
  threshold: number; // 1..oracleIds.length
}

export type PayToken = "native" | "usdc";

export interface CostQuote {
  selection: OracleSelection | null; // null = the gateway's default oracles
  token: PayToken;
  jurorFees: bigint; // in the token's smallest unit
  bridging: { oracleId: number; amount: bigint }[];
  total: bigint; // what GatewayLightbulb pulls or requires (arbitrationCost)
  decimals: number; // 18 for native, the token's decimals for USDC
  symbol: string; // "ETH" or "USDC"
}

export type SelectionError =
  | { kind: "empty" } // no oracle chosen
  | { kind: "threshold-too-high"; threshold: number; selected: number } // ForeignGateway would revert InvalidThreshold
  | { kind: "disabled-oracle"; oracleId: number };

// The lifecycle of one switch request, in order. A request only moves forward. After the delivery it takes one of two
// paths: the court opens the case and rules (dispute-received → ruled → ruling-relaying → switched), or the court
// cannot open it before the creation window closes and the failure comes back instead (creation-failed →
// failure-relaying → closed, with the juror fees refunded). `failed` (a paused delivery) can happen on any relaying leg.
export type RequestStage =
  | "submitted" // requestSwitch tx mined on the foreign chain (LightbulbRequested)
  | "dispute-relaying" // dispute message dispatched; oracles reporting on the home chain
  | "dispute-delivered" // threshold met, HomeGateway.onMessage recorded it (DisputeReceived); not on the court yet
  | "dispute-received" // HomeGateway.createReceivedDispute created it on the arbitrator
  | "ruled" // the arbitrator gave a ruling (KlerosCoreRuler, manual mode on the devnet)
  | "ruling-relaying" // HomeGateway.rule dispatched the ruling; oracles reporting on the foreign chain
  | "switched" // ForeignGateway.executeRuling → GatewayLightbulb.rule; LightbulbSwitched emitted
  | "creation-failed" // not created within the creation window: HomeGateway.sendCreationFailure dispatched the failure
  | "failure-relaying" // oracles reporting the creation failure on the foreign chain
  | "closed" // ForeignGateway.executeRuling → GatewayLightbulb.onDisputeCreationFailed: bulb unchanged, fees refundable
  | "failed";

/** The stages a request can be in, the paused state aside. */
export type FlowStage = Exclude<RequestStage, "failed">;

export interface StageTx {
  stage: FlowStage;
  chain: ChainKey;
  label: string; // the contract call, e.g. "requestSwitch", "executeMessages", "executeRuling"
  hash: Hex;
}

export interface OracleReport {
  oracleId: number;
  leg: "dispute" | "ruling"; // "ruling" is the return leg: it carries the ruling, or the creation failure
  status: "pending" | "reported" | "failed";
}

/**
 * The home chain's side of the two-step creation. HomeGateway.onMessage only records a delivered dispute; then anyone
 * can call createReceivedDispute to open it on the court, or, once `creationTimeout` has passed since the delivery
 * and it is still not created, sendCreationFailure to close it and send the failure back.
 */
export interface CreationStatus {
  state: "waiting" | "created" | "failed"; // failed = sendCreationFailure ran
  deliveredAt: number; // ms since epoch, HomeGateway receivedAt
  failableAt: number; // ms since epoch: from then on anyone can send the creation failure back
  blocker: string | null; // while waiting: why the court cannot open the case right now (plain language), else null
}

/** The juror fees of a request the home chain could not create: claimable once the request is closed. */
export interface Refund {
  token: PayToken;
  amount: bigint; // ForeignGateway feesForJurors (overpayment included); the bridging fees are kept
  claimed: { tx: Hex; beneficiary: Address } | null; // RefundClaimed
}

/**
 * A step that is due and that any wallet can run (none of them needs a role): what a keeper does when one runs. The
 * data layer lists only the steps whose call would go through now.
 */
export type RequestAction =
  | "deliver" // Yaru.executeMessages on the home chain: the dispute leg reached its threshold
  | "create-dispute" // HomeGateway.createReceivedDispute
  | "send-failure" // HomeGateway.sendCreationFailure, after the creation window
  | "deliver-back" // Yaru.executeMessages on the foreign chain: the return leg reached its threshold
  | "execute-ruling" // ForeignGateway.executeRuling: gives the ruling, or the failure, to the GatewayLightbulb
  | "claim-refund"; // GatewayLightbulb.claimRefund: pays the juror fees back to the requester

export interface SwitchRequest {
  disputeId: bigint; // ForeignGateway dispute ID
  homeDisputeId: bigint | null; // set once dispute-received (created on the court)
  owner: Address;
  selection: OracleSelection; // the effective oracles and threshold (the default resolved)
  paid: { token: PayToken; amount: bigint };
  stage: RequestStage;
  ruling: 0 | 1 | 2; // 0 = none yet, 1 = on, 2 = off
  reports: OracleReport[];
  txs: StageTx[];
  error: string | null; // a plain-language reason when stage = "failed"
  creation: CreationStatus | null; // null until the dispute is delivered on the home chain
  refund: Refund | null; // set once closed
  actions: RequestAction[]; // the steps anyone can run now, in lifecycle order
  updatedAt: number; // ms since epoch
}

export interface GatewayBalances {
  homeGatewayWei: bigint; // HomeGateway native balance
  foreignGatewayWei: bigint;
  foreignGatewayUsdc: bigint;
  costPerDisputeWei: bigint;
}

export interface Rates {
  homeNativeRate: bigint; // ForeignGateway homeNativeRate
  usdcPerNative: bigint; // ForeignGateway currency rate for USDC, scaled as the contract stores it
  feeForJuror: bigint; // per juror, General Court
  jurors: number;
  maxChangeBps: number; // keeper guardrails
  cooldownSeconds: number;
}

export interface OpsSnapshot {
  chains: { foreign: ChainInfo; home: ChainInfo };
  addresses: Record<string, Address>; // ForeignGateway, HomeGateway, GatewayLightbulb, KlerosCoreRuler, USDC, ...
  balances: GatewayBalances;
  rates: Rates;
  oracles: Oracle[];
  defaultSelection: OracleSelection;
}

export interface WalletState {
  status: "disconnected" | "connecting" | "connected" | "wrong-chain";
  address: Address | null;
  chainId: number | null;
}

export type Unsubscribe = () => void;

export interface SwitchData {
  chains(): { foreign: ChainInfo; home: ChainInfo };
  oracles(): Promise<Oracle[]>;
  defaultSelection(): Promise<OracleSelection>;
  validateSelection(selection: OracleSelection, oracles: Oracle[]): SelectionError | null;
  quote(selection: OracleSelection | null, token: PayToken): Promise<CostQuote>;
  bulbIsOn(owner: Address): Promise<boolean>; // GatewayLightbulb.lightbulbIsOn
  usdcAllowance(owner: Address): Promise<bigint>; // to GatewayLightbulb
  approveUsdc(amount: bigint): Promise<Hex>; // waits for the receipt
  requestSwitch(selection: OracleSelection | null, token: PayToken): Promise<SwitchRequest>; // waits for the receipt
  request(disputeId: bigint): Promise<SwitchRequest | null>;
  requests(owner: Address): Promise<SwitchRequest[]>; // newest first
  watchRequest(disputeId: bigint, onChange: (request: SwitchRequest) => void): Unsubscribe;
  // Runs one of `request.actions` with the connected wallet, switching it to the chain the step runs on, and waits
  // for the receipt.
  act(disputeId: bigint, action: RequestAction): Promise<Hex>;
  // ops(): Promise<OpsSnapshot> — not implemented: there is no Ops page yet.
  // Devnet only (undefined otherwise): the stand-in for jurors. Gives KlerosCoreRuler's ruling for the request's home
  // dispute with the dev account, 1 = on, 2 = off; the relayer then carries it back.
  devnet?: { rule(disputeId: bigint, ruling: 1 | 2): Promise<Hex> };
}
