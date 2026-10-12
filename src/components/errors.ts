/** The text before the first newline, and whatever follows it (the technical detail). */
export function splitMessage(raw: string): { head: string; detail: string | null } {
  const text = raw.trim();
  const i = text.indexOf("\n");
  if (i < 0) return { head: text, detail: null };
  const detail = text.slice(i + 1).trim();
  return { head: text.slice(0, i).trim(), detail: detail || null };
}

export const isRejection = (raw: string) => /user rejected|user denied|rejected the request|denied transaction/i.test(raw);

function rawMessage(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "string" ? e : "Something went wrong.";
}

/**
 * A plain-language sentence for an error thrown by a wallet or the data layer, and the technical detail to keep
 * under "Technical details". Messages from the data layer already put a plain first paragraph before the detail.
 */
export function describeError(e: unknown): { text: string; detail: string | null } {
  const raw = rawMessage(e);
  const { head, detail } = splitMessage(raw);
  const m = raw.toLowerCase();
  // The data layer words its own errors: a plain first paragraph, the technical detail after the first newline.
  if (/^(cancelled before sending|transaction failed)/i.test(head)) return { text: head, detail };
  if (isRejection(raw)) return { text: "You declined it in your wallet. Nothing was sent.", detail: null };
  if (m.includes("insufficientpayment") || m.includes("insufficient payment"))
    return { text: "The amount sent was below the fee. The fee is read again before you retry.", detail: raw };
  if (m.includes("invalidthreshold"))
    return { text: "More oracles must agree than were chosen. Choose another oracle or lower the requirement.", detail: raw };
  if (m.includes("insufficient allowance") || m.includes("allowance"))
    return { text: "This app may not spend this much USDC yet. Approve the fee first, then send the request.", detail: raw };
  if (m.includes("insufficient funds") || m.includes("exceeds balance"))
    return { text: "This wallet does not hold enough to pay the fee and the network gas.", detail: raw };
  if (m.includes("connector not connected") || m.includes("no account"))
    return { text: "Connect a wallet first.", detail: null };
  if (m.includes("failed to fetch") || m.includes("econnrefused") || m.includes("fetch failed"))
    return { text: "The local network does not answer. Start it and try again.", detail: raw };
  const text = head.length > 300 ? `${head.slice(0, 300)}…` : head;
  return { text, detail: detail ?? (head.length > 300 ? head : null) };
}

export const plainError = (e: unknown): string => describeError(e).text;

export type FailureKind = "cancelled" | "failed" | "unknown";

export interface SendFailure {
  kind: FailureKind;
  title: string;
  message: string;
  detail: string | null;
  advice: string;
}

/**
 * What a failed approval or request tells the person. Three situations read differently: nothing was sent, a
 * transaction was mined and reverted (network gas may have been used), or we cannot tell (look at Track first).
 */
export function sendFailure(e: unknown, action: "approve" | "request" = "request"): SendFailure {
  const raw = rawMessage(e);
  const { text, detail } = describeError(e);
  if (isRejection(raw) || /^cancelled before sending/i.test(text))
    return {
      kind: "cancelled",
      title: "Cancelled before sending",
      message: text,
      detail,
      advice: "You can change the request and try again.",
    };
  if (/gas may have been used|^transaction failed/i.test(text))
    return {
      kind: "failed",
      title: "Transaction failed—network gas may have been used",
      message: text,
      detail,
      advice: "Check the choices and try again.",
    };
  if (action === "approve")
    return {
      kind: "unknown",
      title: "Couldn't confirm USDC approval",
      message: text,
      detail,
      advice: "Check approval status before trying again.",
    };
  return {
    kind: "unknown",
    title: "The request could not be completed",
    message: text,
    detail,
    advice: "Open Track to see whether a request was created before you send another, so you do not pay twice.",
  };
}
