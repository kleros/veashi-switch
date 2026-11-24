import { describe, expect, it, vi } from "vitest";
import { resolveCase, type CaseDeps } from "./chain";
import type { Address, Hex } from "./types";

const LIGHTBULB: Address = "0x9b2F1d258F7ded62874807c6DD15247b5C6Cff37";
const OTHER: Address = "0x00000000000000000000000000000000000000b2";
const LIGHTBULB_V2: Address = "0x00000000000000000000000000000000000000b3";
const ZERO: Hex = `0x${"0".repeat(64)}`;
const HASH: Hex = "0x53e2c77a63f9df726cbc8d1e5bf2b25bfacb17db3780054e59cb883ce5649036";

/** HomeGateway.disputeIDtoHash and ForeignGateway.disputeHashtoDisputeData as on the testnet: case 214 is request 2. */
const deps = (over: Partial<CaseDeps> = {}): CaseDeps => ({
  lightbulbs: [LIGHTBULB],
  hashOf: vi.fn(async (caseId: bigint) => (caseId === 214n ? HASH : ZERO)),
  disputeOf: vi.fn(async (hash: Hex) =>
    hash === HASH ? { id: 2n, arbitrable: LIGHTBULB.toLowerCase() as Address, relayed: true } : { id: 0n, arbitrable: ZERO.slice(0, 42) as Address, relayed: false },
  ),
  ...over,
});

describe("resolveCase (court case number to request)", () => {
  it("finds the request of a case the HomeGateway opened for this lightbulb, in two reads", async () => {
    const d = deps();
    expect(await resolveCase(d, 214n)).toBe(2n);
    expect(d.hashOf).toHaveBeenCalledWith(214n);
    expect(d.disputeOf).toHaveBeenCalledWith(HASH);
    expect(d.hashOf).toHaveBeenCalledTimes(1);
    expect(d.disputeOf).toHaveBeenCalledTimes(1);
  });

  it("is null for a case the HomeGateway did not open, without the second read", async () => {
    const d = deps();
    expect(await resolveCase(d, 999999n)).toBeNull();
    expect(d.disputeOf).not.toHaveBeenCalled();
  });

  it("is null for a case of another arbitrable, or a dispute the ForeignGateway never relayed", async () => {
    expect(await resolveCase(deps({ disputeOf: async () => ({ id: 5n, arbitrable: OTHER, relayed: true }) }), 214n)).toBeNull();
    expect(await resolveCase(deps({ disputeOf: async () => ({ id: 5n, arbitrable: LIGHTBULB, relayed: false }) }), 214n)).toBeNull();
  });

  it("finds the cases of every lightbulb of the site: the first one's stay found once a second one is set", async () => {
    const V2_HASH: Hex = `0x${"ab".repeat(32)}`;
    const both = deps({
      lightbulbs: [LIGHTBULB, LIGHTBULB_V2],
      hashOf: async (caseId) => (caseId === 214n ? HASH : caseId === 215n ? V2_HASH : ZERO),
      disputeOf: async (hash) =>
        hash === HASH
          ? { id: 2n, arbitrable: LIGHTBULB.toLowerCase() as Address, relayed: true }
          : { id: 3n, arbitrable: LIGHTBULB_V2, relayed: true },
    });
    expect(await resolveCase(both, 214n)).toBe(2n);
    expect(await resolveCase(both, 215n)).toBe(3n);
    // a site that only knows the first lightbulb does not claim the second one's case
    expect(await resolveCase({ ...both, lightbulbs: [LIGHTBULB] }, 215n)).toBeNull();
  });

  it("is null for a number no court case can have, without a read", async () => {
    const d = deps();
    expect(await resolveCase(d, 2n ** 256n)).toBeNull();
    expect(await resolveCase(d, -1n)).toBeNull();
    expect(d.hashOf).not.toHaveBeenCalled();
  });

  it("rejects when a read fails (the caller words it), rather than calling it not found", async () => {
    const down = new Error("HTTP request failed. Status: 503");
    await expect(resolveCase(deps({ hashOf: async () => Promise.reject(down) }), 214n)).rejects.toBe(down);
    await expect(resolveCase(deps({ disputeOf: async () => Promise.reject(down) }), 214n)).rejects.toBe(down);
  });
});
