import { formatUnits } from "viem";
import type { Hex, RequestStage, SwitchRequest } from "../data";
import { isFailurePath, reachedStage, stageIndex as lifecycleStageIndex } from "../data/lifecycle";

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

export { STAGES } from "../data/lifecycle";

/** The step of a stage, 0 to 6, on either path; -1 for a paused request. */
export const stageIndex = (s: RequestStage) => (s === "failed" ? -1 : lifecycleStageIndex(s));

/**
 * What the court decided. `ruling` is 0 both before a decision and after one that refused to arbitrate (0 is the
 * court's "Refuse to arbitrate" answer: GatewayLightbulb.rule then leaves the bulb unchanged), so the stage tells them
 * apart: a ruling is known once the request reached "ruled" on the court path.
 */
export type Decision = "pending" | "on" | "off" | "refused";

export function decisionOf(req: SwitchRequest): Decision {
  if (isFailurePath(req) || lifecycleStageIndex(reachedStage(req)) < lifecycleStageIndex("ruled")) return "pending";
  return req.ruling === 1 ? "on" : req.ruling === 2 ? "off" : "refused";
}

/** A decision in a sentence ("The court decided On"); a refusal reads "refused to arbitrate". */
export const decisionName = (d: Decision) =>
  d === "on" ? "On" : d === "off" ? "Off" : d === "refused" ? "refused to arbitrate" : "not decided yet";

export const isHex = (s: string): s is Hex => /^0x[0-9a-fA-F]*$/.test(s);

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
