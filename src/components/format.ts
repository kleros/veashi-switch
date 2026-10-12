import { formatUnits } from "viem";
import type { Hex, RequestStage } from "../data";

/** Digits after the point needed to show `amount` exactly (trailing zeros dropped). */
function exactFraction(amount: bigint, decimals: number): string {
  const frac = formatUnits(amount, decimals).split(".")[1] ?? "";
  return frac.replace(/0+$/, "");
}

const group = (int: string) => Number(int).toLocaleString("en-US");

/** A token amount for people: at least 2 decimals, more only when the value needs them (it is never rounded). */
export function formatAmount(amount: bigint, decimals: number, symbol?: string): string {
  return formatAmounts([amount], decimals, symbol)[0];
}

/**
 * Amounts shown together share one number of decimals, the fewest that show every one exactly, so rows that are
 * displayed always add up to a displayed total.
 */
export function formatAmounts(amounts: bigint[], decimals: number, symbol?: string): string[] {
  const minFrac = Math.min(2, decimals);
  const digits = Math.max(minFrac, ...amounts.map((a) => exactFraction(a, decimals).length));
  return amounts.map((a) => {
    const [int, frac = ""] = formatUnits(a, decimals).split(".");
    const text = `${group(int)}.${frac.padEnd(digits, "0").slice(0, digits)}`;
    return symbol ? `${text} ${symbol}` : text;
  });
}

export const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const STAGES: Exclude<RequestStage, "failed">[] = [
  "submitted",
  "dispute-relaying",
  "dispute-received",
  "ruled",
  "ruling-relaying",
  "switched",
];

export const stageIndex = (s: RequestStage) => STAGES.indexOf(s as Exclude<RequestStage, "failed">);

export const rulingName = (r: 0 | 1 | 2) => (r === 1 ? "On" : r === 2 ? "Off" : "not decided yet");

export const isHex = (s: string): s is Hex => /^0x[0-9a-fA-F]*$/.test(s);

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
