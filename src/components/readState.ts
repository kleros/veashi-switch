// State models for reads that can be unknown or fail: the bulb read, the Track request load, the fee quote and what
// the payment area offers after a failed submission. Pure, so unit tests can hold them.
import type { Address, SwitchData, SwitchRequest } from "../data";
import { plainError, type SendFailure } from "./errors";

/** A bulb read is one of these four; unknown is never drawn or said as off. */
export type BulbRead =
  | { kind: "disconnected" }
  | { kind: "loading" }
  | { kind: "known"; on: boolean }
  | { kind: "failed" };

export const BULB_DISCONNECTED: BulbRead = { kind: "disconnected" };
export const BULB_LOADING: BulbRead = { kind: "loading" };

/** The read that belongs to `owner`: what was stored for another account (or none) is cleared, not shown. */
export function resolveBulbRead(stored: { owner: string; read: BulbRead } | null, owner: string | null): BulbRead {
  if (!owner) return BULB_DISCONNECTED;
  if (!stored || stored.owner.toLowerCase() !== owner.toLowerCase()) return BULB_LOADING;
  return stored.read;
}

/** Reads `bulbIsOn(owner)` with a few short retries; the callbacks fire only while `live()` is true (obsolete responses are ignored). */
export function readBulb(
  data: Pick<SwitchData, "bulbIsOn">,
  owner: Address,
  live: () => boolean,
  done: (r: BulbRead) => void,
  retries = 2,
  delayMs = 800,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = (left: number) =>
    data.bulbIsOn(owner).then(
      (on) => live() && done({ kind: "known", on }),
      () => {
        if (!live()) return;
        if (left > 0) timer = setTimeout(() => attempt(left - 1), delayMs);
        else done({ kind: "failed" });
      },
    );
  void attempt(retries);
  return () => timer && clearTimeout(timer);
}

/** The bulb read Track keeps: whose bulb, and whether it was read while the court decides or once the request is final. */
export interface StoredBulb {
  owner: string;
  phase: "court" | "final";
  read: BulbRead;
}

/**
 * The bulb read Track shows: the stored one only when it is for this owner and this phase. A read for another owner,
 * or one made while the court decided, is never shown once the decision is applied (it is not the result's bulb):
 * that is loading until the read of the current phase returns. Within the court phase the last read stays shown while
 * a refresh is in flight.
 */
export function shownBulb(stored: StoredBulb | null, owner: string | undefined, phase: StoredBulb["phase"] | null): BulbRead {
  if (!owner || !phase || !stored) return BULB_LOADING;
  if (stored.owner.toLowerCase() !== owner.toLowerCase() || stored.phase !== phase) return BULB_LOADING;
  return stored.read;
}

/** Something a refresh can wake on: `document` (visibilitychange) and `window` (focus). */
type WakeTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Re-reads the bulb while the court decides: every `everyMs`, and when the page is shown or focused again (jurors may
 * leave a tab open for days). Never while a read is in flight (a new read would cancel its retries) or while the page
 * is hidden. Returns the stop function.
 */
export function startBulbRefresh(
  refresh: () => void,
  opts: { everyMs: number; busy: () => boolean; hidden: () => boolean; wake?: { target: WakeTarget; type: string }[] },
): () => void {
  const tick = () => {
    if (!opts.busy() && !opts.hidden()) refresh();
  };
  const timer = setInterval(tick, opts.everyMs);
  for (const w of opts.wake ?? []) w.target.addEventListener(w.type, tick);
  return () => {
    clearInterval(timer);
    for (const w of opts.wake ?? []) w.target.removeEventListener(w.type, tick);
  };
}

/** A court case number looked up for its request (the /case page): found, not this site's case, or a failed read. */
export type CaseLookup =
  | { kind: "loading" }
  | { kind: "found"; requestId: bigint }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const MAX_UINT256 = 2n ** 256n - 1n;

/** A court case number as typed or in a link: whole digits within uint256 (the court's dispute IDs); null otherwise. */
export function parseCaseNumber(s: string): bigint | null {
  if (!/^\d+$/.test(s)) return null;
  const n = BigInt(s);
  return n <= MAX_UINT256 ? n : null;
}

/** Resolves a Kleros court case number to its request; a failed read becomes a plain message, never a rejection. */
export async function lookupCase(data: Pick<SwitchData, "caseRequest">, caseId: bigint): Promise<CaseLookup> {
  try {
    const requestId = await data.caseRequest(caseId);
    return requestId === null ? { kind: "missing" } : { kind: "found", requestId };
  } catch (e) {
    return { kind: "error", message: plainError(e) };
  }
}

export const BANNER_STALE = "Updates unavailable—showing last known status";

export interface TrackState {
  req: SwitchRequest | null | undefined;
  error: string | null;
}
export type TrackAction =
  | { type: "reset" }
  | { type: "loaded"; req: SwitchRequest | null }
  | { type: "failed"; error: string }
  | { type: "retry" };

export const trackInitial: TrackState = { req: undefined, error: null };

/** Any successful read, including a subscription update, clears the error; a failure never drops loaded data. */
export function trackReducer(s: TrackState, a: TrackAction): TrackState {
  switch (a.type) {
    case "reset":
      return trackInitial;
    case "retry":
      return { ...s, error: null };
    case "failed":
      return { ...s, error: a.error };
    case "loaded":
      return {
        req: s.req && a.req && s.req.updatedAt > a.req.updatedAt ? s.req : a.req,
        error: null,
      };
  }
}

export type TrackView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "missing" }
  | { kind: "request"; banner: string | null };

export function trackView(s: TrackState): TrackView {
  if (s.req === undefined) return s.error ? { kind: "error", message: s.error } : { kind: "loading" };
  if (s.req === null) return { kind: "missing" };
  return { kind: "request", banner: s.error ? BANNER_STALE : null };
}

/**
 * A periodic read beside `watchRequest` (which cannot report that it stalled): its rejection and success feed the
 * same error state. Returns the stop function.
 */
export function startHealthPoll(
  read: () => Promise<SwitchRequest | null>,
  intervalMs: number,
  onOk: (r: SwitchRequest | null) => void,
  onError: (e: unknown) => void,
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    read().then(
      (r) => !stopped && onOk(r),
      (e) => !stopped && onError(e),
    );
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export interface CostStatus {
  text: string;
  retry: boolean;
  loading: boolean; // a quote is on its way: the text is a loading state
}

/** What the cost area says when there is no actionable quote. */
export function costStatus(o: { selError: boolean; quoteError: string | null; updating: boolean; hadQuote: boolean }): CostStatus {
  if (o.selError) return { text: "Fix the oracle choice to see the cost.", retry: false, loading: false };
  if (o.quoteError) return { text: o.quoteError, retry: true, loading: false };
  if (o.updating && o.hadQuote) return { text: "Updating cost…", retry: false, loading: true };
  return { text: "Calculating request fee…", retry: false, loading: true };
}

export interface SubmissionActions {
  primary: "send" | "check";
  sendEnabled: boolean; // the ordinary send action may be used
  showSendAgain: boolean; // the secondary "Send again…" is offered
}

/** After a failed submission whose outcome is unknown the primary action is to check Track; sending again needs an acknowledgement. */
export function submissionActions(failure: SendFailure | null, acknowledged: boolean): SubmissionActions {
  if (failure?.kind !== "unknown") return { primary: "send", sendEnabled: true, showSendAgain: false };
  return { primary: acknowledged ? "send" : "check", sendEnabled: acknowledged, showSendAgain: true };
}
