import type { CostQuote } from "../data";
import { formatAmounts } from "./format";

export interface CostLine {
  key: string;
  label: string;
  text: string; // in the quote's token, no symbol (the column header carries it)
  oracleId?: number;
}

export interface CostBreakdown {
  lines: CostLine[];
  total: string; // with the symbol
  totalNumber: string;
  symbol: string;
}

/**
 * The displayed lines of a quote. They share one precision, so the displayed lines add up exactly to the displayed
 * total; whatever the quote's parts do not cover (if anything) is its own line instead of a silent difference.
 */
export function costBreakdown(quote: CostQuote, oracleName: (id: number) => string): CostBreakdown {
  const parts: { key: string; label: string; amount: bigint; oracleId?: number }[] = [
    { key: "jurors", label: "Juror fees", amount: quote.jurorFees },
    ...quote.bridging.map((b) => ({
      key: `oracle-${b.oracleId}`,
      label: oracleName(b.oracleId),
      amount: b.amount,
      oracleId: b.oracleId,
    })),
  ];
  const sum = parts.reduce((s, p) => s + p.amount, 0n);
  if (sum !== quote.total) parts.push({ key: "other", label: "Other fees", amount: quote.total - sum });
  const texts = formatAmounts([...parts.map((p) => p.amount), quote.total], quote.decimals);
  const totalNumber = texts[texts.length - 1];
  return {
    lines: parts.map((p, i) => ({ key: p.key, label: p.label, text: texts[i], oracleId: p.oracleId })),
    total: `${totalNumber} ${quote.symbol}`,
    totalNumber,
    symbol: quote.symbol,
  };
}

/** Sum of the displayed line texts, as a bigint in the token's smallest unit (for tests and sanity checks). */
export function displayedSum(lines: CostLine[], decimals: number): bigint {
  const toUnits = (t: string) => {
    const [i, f = ""] = t.replace(/,/g, "").split(".");
    return BigInt(i) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0").slice(0, decimals) || "0");
  };
  return lines.reduce((s, l) => s + toUnits(l.text), 0n);
}
