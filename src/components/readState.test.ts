import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, SwitchRequest } from "../data";
import { sendFailure } from "./errors";
import {
  BANNER_STALE,
  costStatus,
  readBulb,
  resolveBulbRead,
  startHealthPoll,
  submissionActions,
  trackInitial,
  trackReducer,
  trackView,
} from "./readState";

const A = "0x00000000000000000000000000000000000000a1" as Address;
const B = "0x00000000000000000000000000000000000000b2" as Address;
const R = (updatedAt: number) => ({ disputeId: 1n, stage: "dispute-relaying", updatedAt }) as unknown as SwitchRequest;

afterEach(() => vi.useRealTimers());

describe("bulb read states", () => {
  it("is disconnected without an account, loading before a read and cleared when the account changes", () => {
    expect(resolveBulbRead(null, null)).toEqual({ kind: "disconnected" });
    expect(resolveBulbRead(null, A)).toEqual({ kind: "loading" });
    const stored = { owner: A, read: { kind: "known", on: true } as const };
    expect(resolveBulbRead(stored, A)).toEqual({ kind: "known", on: true });
    expect(resolveBulbRead(stored, B)).toEqual({ kind: "loading" });
    expect(resolveBulbRead(stored, null)).toEqual({ kind: "disconnected" });
  });

  it("resolves known, fails after the retries and ignores obsolete responses", async () => {
    vi.useFakeTimers();
    const ok = vi.fn();
    readBulb({ bulbIsOn: async () => true }, A, () => true, ok);
    await vi.advanceTimersByTimeAsync(0);
    expect(ok).toHaveBeenCalledWith({ kind: "known", on: true });

    const failed = vi.fn();
    readBulb({ bulbIsOn: async () => Promise.reject(new Error("down")) }, A, () => true, failed);
    await vi.advanceTimersByTimeAsync(3000);
    expect(failed).toHaveBeenCalledWith({ kind: "failed" });

    const stale = vi.fn();
    readBulb({ bulbIsOn: async () => false }, A, () => false, stale);
    await vi.advanceTimersByTimeAsync(3000);
    expect(stale).not.toHaveBeenCalled();
  });
});

describe("Track load state", () => {
  it("keeps loaded data under an error and clears the error on any success", () => {
    let s = trackReducer(trackInitial, { type: "failed", error: "down" });
    expect(trackView(s)).toEqual({ kind: "error", message: "down" });
    s = trackReducer(s, { type: "retry" });
    expect(trackView(s)).toEqual({ kind: "loading" });
    s = trackReducer(s, { type: "loaded", req: R(10) });
    expect(trackView(s)).toEqual({ kind: "request", banner: null });
    s = trackReducer(s, { type: "failed", error: "down" });
    expect(s.req).not.toBeNull();
    expect(trackView(s)).toEqual({ kind: "request", banner: BANNER_STALE });
    s = trackReducer(s, { type: "loaded", req: R(11) }); // e.g. a subscription update
    expect(trackView(s)).toEqual({ kind: "request", banner: null });
    expect(trackReducer(s, { type: "loaded", req: R(5) }).req?.updatedAt).toBe(11);
  });

  it("a health read that fails and then recovers shows the banner and clears it while the request stays", async () => {
    vi.useFakeTimers();
    let fail = false;
    let s = trackReducer(trackInitial, { type: "loaded", req: R(1) });
    const stop = startHealthPoll(
      async () => {
        if (fail) throw new Error("down");
        return R(2);
      },
      1000,
      (r) => (s = trackReducer(s, { type: "loaded", req: r })),
      () => (s = trackReducer(s, { type: "failed", error: "down" })),
    );
    fail = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(trackView(s)).toEqual({ kind: "request", banner: BANNER_STALE });
    expect(s.req).not.toBeNull();
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(trackView(s)).toEqual({ kind: "request", banner: null });
    stop();
    fail = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(trackView(s)).toEqual({ kind: "request", banner: null });
  });
});

describe("fee quote status", () => {
  it("offers Retry fee calculation only for a quote error", () => {
    const base = { selError: false, quoteError: null, updating: false, hadQuote: false };
    expect(costStatus({ ...base, quoteError: "no answer" })).toEqual({ text: "no answer", retry: true });
    expect(costStatus({ ...base, updating: true, hadQuote: true })).toEqual({ text: "Updating cost…", retry: false });
    expect(costStatus({ ...base, selError: true }).retry).toBe(false);
  });
});

describe("uncertain submission", () => {
  it("makes Check your requests primary and Send again need an acknowledgement; confirmed failures keep the ordinary retry", () => {
    const unknown = sendFailure(new Error("The wallet closed unexpectedly"));
    expect(unknown.kind).toBe("unknown");
    expect(submissionActions(unknown, false)).toEqual({ primary: "check", sendEnabled: false, showSendAgain: true });
    expect(submissionActions(unknown, true)).toMatchObject({ sendEnabled: true, showSendAgain: true });
    for (const msg of ["Cancelled before sending. x", "Transaction failed: network gas may have been used."]) {
      expect(submissionActions(sendFailure(new Error(msg)), false)).toEqual({ primary: "send", sendEnabled: true, showSendAgain: false });
    }
    expect(submissionActions(null, false).primary).toBe("send");
  });

  it("words an approval error for the approval, not the request submission", () => {
    const f = sendFailure(new Error("The wallet closed unexpectedly"), "approve");
    expect(f.title).toBe("Couldn't confirm USDC approval");
    expect(f.advice).toBe("Check approval status before trying again.");
    expect(`${f.title} ${f.advice}`).not.toMatch(/Open Track|request could not/i);
  });
});
