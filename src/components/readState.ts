// State models for reads that can be unknown or fail: the bulb read, the Track request load, the fee quote and what
// the payment area offers after a failed submission. Pure, so unit tests can hold them.
import type { Address, SwitchData, SwitchRequest } from "../data";
import type { SendFailure } from "./errors";

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
}

/** What the cost area says when there is no actionable quote. */
export function costStatus(o: { selError: boolean; quoteError: string | null; updating: boolean; hadQuote: boolean }): CostStatus {
  if (o.selError) return { text: "Fix the oracle choice to see the cost.", retry: false };
  if (o.quoteError) return { text: o.quoteError, retry: true };
  if (o.updating && o.hadQuote) return { text: "Updating cost…", retry: false };
  return { text: "Calculating request fee…", retry: false };
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
