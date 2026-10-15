// The seam between the data layer (src/data implements it) and the pages (they render it): change it on both sides.
// Field names follow the gateways and lightbulb in the kleros-v2 submodule (its contracts/src/gateway).

export type Hex = `0x${string}`;
export type Address = Hex;

export type ChainKey = "foreign" | "home"; // foreign = Base-like devnet chain, home = Arbitrum-like devnet chain

export interface ChainInfo {
  key: ChainKey;
  id: number;
  name: string; // shown in the UI, e.g. "Base (devnet)"
  rpcUrl: string; // always a local anvil URL
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

// The lifecycle of one switch request, in order. A request only moves forward; `failed` can happen at any step.
export type RequestStage =
  | "submitted" // requestSwitch tx mined on the foreign chain (LightbulbRequested)
  | "dispute-relaying" // dispute message dispatched; oracles reporting on the home chain
  | "dispute-received" // threshold met, HomeGateway.onMessage ran, dispute created on the arbitrator
  | "ruled" // the arbitrator gave a ruling (KlerosCoreRuler, manual mode on the devnet)
  | "ruling-relaying" // HomeGateway.rule dispatched the ruling; oracles reporting on the foreign chain
  | "switched" // ForeignGateway.onMessage → GatewayLightbulb.rule; LightbulbSwitched emitted
  | "failed";

export interface StageTx {
  stage: Exclude<RequestStage, "failed">;
  chain: ChainKey;
  label: string; // the contract call, e.g. "requestSwitch", "executeMessages", "executeRuling"
  hash: Hex;
}

export interface OracleReport {
  oracleId: number;
  leg: "dispute" | "ruling";
  status: "pending" | "reported" | "failed";
}

export interface SwitchRequest {
  disputeId: bigint; // ForeignGateway dispute ID
  homeDisputeId: bigint | null; // set once dispute-received
  owner: Address;
  selection: OracleSelection; // the effective oracles and threshold (the default resolved)
  paid: { token: PayToken; amount: bigint };
  stage: RequestStage;
  ruling: 0 | 1 | 2; // 0 = none yet, 1 = on, 2 = off
  reports: OracleReport[];
  txs: StageTx[];
  error: string | null; // a plain-language reason when stage = "failed"
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
  // ops(): Promise<OpsSnapshot> — not implemented: there is no Ops page yet.
  // Devnet only (undefined otherwise): the stand-in for jurors. Gives KlerosCoreRuler's ruling for the request's home
  // dispute with the dev account, 1 = on, 2 = off; the relayer then carries it back.
  devnet?: { rule(disputeId: bigint, ruling: 1 | 2): Promise<Hex> };
}
