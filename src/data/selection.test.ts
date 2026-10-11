import { describe, expect, it } from "vitest";
import { normalizeSelection, validateSelection } from "./selection";
import type { Oracle } from "./types";

const oracle = (id: number, enabled = true): Oracle => ({
  id,
  name: `O${id}`,
  via: "",
  enabled,
  bridgingCostWei: 1n,
});
const oracles = [oracle(0), oracle(1), oracle(2, false), oracle(3)];

describe("validateSelection mirrors ForeignGateway._validateSelection", () => {
  it("accepts a valid selection", () => {
    expect(validateSelection({ oracleIds: [0, 1, 3], threshold: 2 }, oracles)).toBeNull();
    expect(validateSelection({ oracleIds: [3], threshold: 1 }, oracles)).toBeNull();
  });
  it("reports an empty selection", () => {
    expect(validateSelection({ oracleIds: [], threshold: 1 }, oracles)).toEqual({ kind: "empty" });
  });
  it("reports a threshold above the count (InvalidThreshold)", () => {
    expect(validateSelection({ oracleIds: [0, 1], threshold: 3 }, oracles)).toEqual({
      kind: "threshold-too-high",
      threshold: 3,
      selected: 2,
    });
  });
  it("reports a zero threshold as InvalidThreshold too", () => {
    expect(validateSelection({ oracleIds: [0], threshold: 0 }, oracles)).toMatchObject({ kind: "threshold-too-high" });
  });
  it("reports a disabled or unknown oracle (OracleNotEnabled)", () => {
    expect(validateSelection({ oracleIds: [0, 2], threshold: 1 }, oracles)).toEqual({ kind: "disabled-oracle", oracleId: 2 });
    expect(validateSelection({ oracleIds: [0, 7], threshold: 1 }, oracles)).toEqual({ kind: "disabled-oracle", oracleId: 7 });
  });
  it("checks the threshold before the oracles, in the contract's order", () => {
    expect(validateSelection({ oracleIds: [2], threshold: 2 }, oracles)).toMatchObject({ kind: "threshold-too-high" });
  });
  it("normalizes to sorted, distinct IDs", () => {
    expect(normalizeSelection({ oracleIds: [3, 0, 3, 1], threshold: 2 })).toEqual({ oracleIds: [0, 1, 3], threshold: 2 });
  });
});
