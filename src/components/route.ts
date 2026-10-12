import type { ChainInfo, CostQuote, OracleSelection, PayToken, SwitchRequest } from "../data";

/** The one fixed route: requests go from the foreign (Base-like) chain to the home (Arbitrum-like) chain and the ruling returns. */
export interface RouteConfig {
  from: ChainInfo;
  to: ChainInfo;
  fromLabel: string; // "Base-like local devnet"
  toLabel: string;
  pill: string; // "Local · Base-like → Arbitrum-like"
}

export function routeConfig(chains: { foreign: ChainInfo; home: ChainInfo }): RouteConfig {
  return {
    from: chains.foreign,
    to: chains.home,
    fromLabel: `${chains.foreign.name} local devnet`,
    toLabel: `${chains.home.name} local devnet`,
    pill: `Local · ${chains.foreign.name} → ${chains.home.name}`,
  };
}

export type WalletGate =
  | { state: "unavailable"; message: string; canTransact: false }
  | { state: "disconnected"; message: string; canTransact: false }
  | { state: "connecting"; message: string; canTransact: false }
  | { state: "wrong-chain"; message: string; canTransact: false; onHomeChain: boolean }
  | { state: "ready"; message: string; canTransact: true };

/** What the wallet strip and the pay section show, from the wallet's status and the local network's. */
export function walletGate(args: {
  networkUp: boolean;
  status: "disconnected" | "connecting" | "connected" | "wrong-chain";
  chainId: number | null;
  route: RouteConfig;
}): WalletGate {
  const { networkUp, status, chainId, route } = args;
  if (!networkUp)
    return { state: "unavailable", message: "Local network unavailable", canTransact: false };
  if (status === "connecting") return { state: "connecting", message: "Connecting…", canTransact: false };
  if (status === "disconnected")
    return { state: "disconnected", message: "Connect a wallet to send. The route and fees are visible without one.", canTransact: false };
  if (status === "wrong-chain")
    return {
      state: "wrong-chain",
      message: `Your wallet is on a different network. Switch to ${route.fromLabel} to send.`,
      canTransact: false,
      onHomeChain: chainId === route.to.id,
    };
  return { state: "ready", message: `Wallet on ${route.fromLabel}`, canTransact: true };
}

export interface RequestConfig {
  selection: OracleSelection | null; // null = the default selection
  token: PayToken;
}

const sameSelection = (a: OracleSelection | null, b: OracleSelection | null) =>
  a === null || b === null
    ? a === b
    : a.threshold === b.threshold &&
      a.oracleIds.length === b.oracleIds.length &&
      a.oracleIds.every((id, i) => id === b.oracleIds[i]);

/** A quote is actionable only when it was made for the configuration that is on screen now. */
export function quoteMatches(quote: CostQuote | null, cfg: RequestConfig): quote is CostQuote {
  return !!quote && quote.token === cfg.token && sameSelection(quote.selection, cfg.selection);
}

export type ListState = "loading" | "failed" | "empty" | "ready";

/** The request list on Track: loading, failed (with a retry) and empty are told apart. */
export function listState(args: { loading: boolean; error: string | null; items: SwitchRequest[] | null }): ListState {
  if (args.error) return "failed";
  if (args.loading || args.items === null) return "loading";
  return args.items.length ? "ready" : "empty";
}
