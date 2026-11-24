import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, SwitchRequest } from "../data";
import { sendFailure } from "./errors";
import {
  BANNER_STALE,
  costStatus,
  lookupCase,
  parseCaseNumber,
  readBulb,
  resolveBulbRead,
  shownBulb,
  startBulbRefresh,
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

describe("court case numbers", () => {
  it("are whole digits within uint256, as the court's dispute IDs", () => {
    expect(parseCaseNumber("214")).toBe(214n);
    expect(parseCaseNumber("00214")).toBe(214n);
    expect(parseCaseNumber("0")).toBe(0n);
    expect(parseCaseNumber((2n ** 256n - 1n).toString())).toBe(2n ** 256n - 1n);
    for (const s of ["", "abc", "-1", "214 ", "1e3", "２１４", (2n ** 256n).toString(), "9".repeat(106)]) expect(parseCaseNumber(s)).toBeNull();
  });
});

describe("Track's bulb while the court decides and after", () => {
  const court = (on: boolean) => ({ owner: A, phase: "court" as const, read: { kind: "known" as const, on } });

  it("shows a read only for its owner and its phase: a court-time read is never the result's bulb", () => {
    expect(shownBulb(court(true), A, "court")).toEqual({ kind: "known", on: true });
    expect(shownBulb(court(true), A.toUpperCase().replace("0X", "0x"), "court")).toEqual({ kind: "known", on: true });
    expect(shownBulb(court(true), A, "final")).toEqual({ kind: "loading" });
    expect(shownBulb(court(true), B, "court")).toEqual({ kind: "loading" });
    expect(shownBulb(null, A, "court")).toEqual({ kind: "loading" });
    expect(shownBulb(court(true), undefined, "court")).toEqual({ kind: "loading" });
    expect(shownBulb(court(true), A, null)).toEqual({ kind: "loading" });
    expect(shownBulb({ owner: A, phase: "final", read: { kind: "failed" } }, A, "final")).toEqual({ kind: "failed" });
  });

  it("shows a read only for its lightbulb: the same owner's bulb on the other lightbulb is another bulb", () => {
    const LB1 = "0x9b2F1d258F7ded62874807c6DD15247b5C6Cff37";
    const LB2 = "0x00000000000000000000000000000000000000b3";
    const on1 = { owner: A, lightbulb: LB1, phase: "final" as const, read: { kind: "known" as const, on: true } };
    expect(shownBulb(on1, A, "final", LB1)).toEqual({ kind: "known", on: true });
    expect(shownBulb(on1, A, "final", LB1.toLowerCase())).toEqual({ kind: "known", on: true });
    expect(shownBulb(on1, A, "final", LB2)).toEqual({ kind: "loading" });
    expect(shownBulb(on1, A, "final")).toEqual({ kind: "loading" });
    expect(shownBulb(court(true), A, "court", LB1)).toEqual({ kind: "loading" });
  });

  it("re-reads on a timer and when the page is shown again, never while a read is in flight or the page is hidden", async () => {
    vi.useFakeTimers();
    const page = new EventTarget();
    let busy = false;
    let hidden = false;
    let reads = 0;
    const stop = startBulbRefresh(() => reads++, {
      everyMs: 30_000,
      busy: () => busy,
      hidden: () => hidden,
      wake: [{ target: page, type: "visibilitychange" }],
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(reads).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(reads).toBe(1);
    busy = true; // the read is still retrying: a new one would cancel it
    await vi.advanceTimersByTimeAsync(30_000);
    page.dispatchEvent(new Event("visibilitychange"));
    expect(reads).toBe(1);
    busy = false;
    hidden = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads).toBe(1);
    hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(reads).toBe(2);
    stop();
    await vi.advanceTimersByTimeAsync(90_000);
    page.dispatchEvent(new Event("visibilitychange"));
    expect(reads).toBe(2);
  });
});

describe("court case lookup (the /case page)", () => {
  it("found: the request the case belongs to", async () => {
    expect(await lookupCase({ caseRequest: async (c) => (c === 214n ? 2n : null) }, 214n)).toEqual({ kind: "found", requestId: 2n });
  });

  it("not found: a case that is not one of this site's requests", async () => {
    expect(await lookupCase({ caseRequest: async () => null }, 999999n)).toEqual({ kind: "missing" });
  });

  it("read error: a plain message, never a rejection, and not taken for not found", async () => {
    const r = await lookupCase(
      { caseRequest: async () => Promise.reject(new Error("The test network does not answer. Try again in a moment.\nHTTP 503")) },
      214n,
    );
    expect(r).toEqual({ kind: "error", message: "The test network does not answer. Try again in a moment." });
  });
});

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
    expect(costStatus({ ...base, quoteError: "no answer" })).toEqual({ text: "no answer", retry: true, loading: false });
    expect(costStatus({ ...base, updating: true, hadQuote: true })).toEqual({ text: "Updating cost…", retry: false, loading: true });
    expect(costStatus({ ...base, selError: true })).toMatchObject({ retry: false, loading: false });
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
