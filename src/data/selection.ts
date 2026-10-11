import type { Oracle, OracleSelection, SelectionError } from "./types";

/**
 * Mirrors ForeignGateway._validateSelection, in the same order: an empty selection, then the threshold
 * (`InvalidThreshold` when 0 or above the count), then each oracle (`OracleNotEnabled` when unknown or disabled).
 */
export function validateSelection(selection: OracleSelection, oracles: Oracle[]): SelectionError | null {
  const selected = selection.oracleIds.length;
  if (selected === 0) return { kind: "empty" };
  if (selection.threshold < 1 || selection.threshold > selected) {
    return { kind: "threshold-too-high", threshold: selection.threshold, selected };
  }
  for (const oracleId of selection.oracleIds) {
    const oracle = oracles.find((o) => o.id === oracleId);
    if (!oracle || !oracle.enabled) return { kind: "disabled-oracle", oracleId };
  }
  return null;
}

/** Sorted, distinct oracle IDs as the gateways expect them. */
export function normalizeSelection(selection: OracleSelection): OracleSelection {
  return { oracleIds: [...new Set(selection.oracleIds)].sort((a, b) => a - b), threshold: selection.threshold };
}
