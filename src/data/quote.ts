import type { CostQuote, OracleSelection, PayToken } from "./types";

export const RATE_PRECISION = 10n ** 18n;
const DEFAULT_NB_OF_JURORS = 3n;

/** What ForeignGateway.extraDataToCourtIDMinJurors reads from the lightbulb's `arbitratorExtraData`. */
export function decodeCourtAndJurors(extraData: `0x${string}`): { courtId: bigint; jurors: bigint } {
  const hex = extraData.slice(2);
  if (hex.length < 128) return { courtId: 0n, jurors: DEFAULT_NB_OF_JURORS };
  const courtWord = BigInt(`0x${hex.slice(0, 64)}`);
  const jurors = BigInt(`0x${hex.slice(64, 128)}`);
  return { courtId: courtWord & ((1n << 96n) - 1n), jurors: jurors === 0n ? DEFAULT_NB_OF_JURORS : jurors };
}

/** Contract reads that make up one quote; `total` is the `arbitrationCost` overload for the selection and token. */
export interface QuoteReads {
  selection: OracleSelection | null;
  oracleIds: number[]; // the effective oracles (the default resolved)
  token: PayToken;
  feeForJuror: bigint; // ForeignGateway.feeForJuror(courtId), 0 falls back to court 0 as the gateway does
  jurors: bigint;
  homeNativeRate: bigint;
  bridgingCosts: Record<number, bigint>; // ForeignGateway.oracleBridgingCost, native
  toToken: (amountInNative: bigint) => bigint; // ForeignGateway.convertEthToTokenAmount for USDC, identity for native
  total: bigint;
  decimals: number;
  symbol: string;
}

/** The cost breakdown the Request page shows; the parts use the gateway's formulas, the total is the contract's. */
export function assembleQuote(reads: QuoteReads): CostQuote {
  const jurorFeesNative = (reads.feeForJuror * reads.jurors * reads.homeNativeRate) / RATE_PRECISION;
  return {
    selection: reads.selection,
    token: reads.token,
    jurorFees: reads.toToken(jurorFeesNative),
    bridging: reads.oracleIds.map((oracleId) => ({
      oracleId,
      amount: reads.toToken(reads.bridgingCosts[oracleId] ?? 0n),
    })),
    total: reads.total,
    decimals: reads.decimals,
    symbol: reads.symbol,
  };
}
