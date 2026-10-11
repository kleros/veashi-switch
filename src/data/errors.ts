// Turns reverts and wallet errors into the plain-language sentences the app shows.
import { BaseError, decodeErrorResult, formatEther, isHex, type Hex } from "viem";
import { allErrorsAbi } from "./abi";

export interface DecodedRevert {
  errorName: string;
  args: readonly unknown[];
}

export interface ErrorContext {
  oracleName?: (oracleId: number) => string;
  homeChainName?: string;
  usdcDecimals?: number;
}

/** Finds the custom error behind a viem error (or raw revert data), walking the cause chain. */
export function findRevert(error: unknown): DecodedRevert | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const c = current as { data?: unknown; cause?: unknown; raw?: unknown };
    const data = c.data;
    if (data && typeof data === "object" && typeof (data as DecodedRevert).errorName === "string") {
      const decoded = data as DecodedRevert;
      return { errorName: decoded.errorName, args: decoded.args ?? [] };
    }
    for (const candidate of [data, c.raw]) {
      if (typeof candidate === "string" && isHex(candidate) && candidate.length >= 10) {
        const decoded = decodeRevertData(candidate);
        if (decoded) return decoded;
      }
    }
    current = c.cause;
  }
  return null;
}

export function decodeRevertData(data: Hex): DecodedRevert | null {
  try {
    const decoded = decodeErrorResult({ abi: allErrorsAbi, data });
    return { errorName: decoded.errorName, args: (decoded.args ?? []) as readonly unknown[] };
  } catch {
    return null;
  }
}

const eth = (wei: unknown) => `${formatEther(BigInt(wei as bigint))} ETH`;

/** The sentence for one custom error, or null for an error this app has no wording for. */
export function describeRevert(revert: DecodedRevert, context: ErrorContext = {}): string | null {
  const a = revert.args;
  const home = context.homeChainName ?? "the home chain";
  switch (revert.errorName) {
    case "InsufficientPayment":
    case "ArbitrationFeesNotEnough":
      return "The amount sent is less than the cost of this request. The cost may have changed: refresh it and send again.\nThe gateway reverted with InsufficientPayment.";
    case "InvalidThreshold":
      return a.length === 2
        ? `The agreement threshold (${a[0]}) is higher than the number of oracles (${a[1]}).\nThe gateway reverted with InvalidThreshold.`
        : "The agreement threshold must be between 1 and the number of oracles you selected.\nThe gateway reverted with InvalidThreshold.";
    case "OracleNotEnabled": {
      const id = Number(a[0]);
      return `${context.oracleName?.(id) ?? `Oracle #${id}`} is not available. Choose other oracles.\nOracle #${id} is not enabled on the gateway.`;
    }
    case "DuplicateOracle":
      return `An oracle is selected twice. Select each oracle once.\nOracle #${Number(a[0])} appears twice in the selection.`;
    case "InsufficientFunds":
      return `The court side of this local devnet lacks local ETH to open the case. The local operator needs to fund it.\nThe HomeGateway on ${home} needs ${eth(a[0])} and holds ${eth(a[1])}; the case is created as soon as it is funded.`;
    case "ReporterCannotPay":
      return `This oracle's relay service lacks local ETH for delivery. The local operator needs to fund it.\nThe ${String(a[0])} reporter cannot pay its bridge fee (needs ${eth(a[1])}, holds ${eth(a[2])}). Try again later, or choose oracles without ${String(a[0])}.`;
    case "TokenNotAccepted":
      return "This token is not accepted for fees. Pay in ETH instead.\nThe gateway does not accept this token.";
    case "ERC20InsufficientAllowance":
      return "The approved USDC amount is too low. Approve the total first, then send.\nThe Lightbulb is not approved to pull enough USDC.";
    case "ERC20InsufficientBalance":
      return "Your wallet does not hold enough USDC for this request.\nERC20InsufficientBalance.";
    case "TransferFailed":
      return "The token transfer failed.\nTransferFailed.";
    case "ThresholdNotMet":
      return `Not enough oracles have reported yet (${a[0]} of ${a[1]}). The message moves on once enough of them report.`;
    case "MessageIdAlreadyExecuted":
    case "DisputeAlreadyReceived":
      return "This message was already delivered.";
    case "CannotRuleTwice":
    case "AlreadyRuled":
    case "RulingAlreadyExecuted":
      return "This dispute already has a ruling.";
    case "RulerOnly":
      return "Only the devnet ruler account can give this ruling.";
    case "RulingModeNotSet":
      return "The court has no ruling mode set; redeploy the devnet.";
    case "UnexpectedAdapters":
      return "The message was verified by other oracles than the ones selected for this request, so it was refused.\nThe gateway reverted with UnexpectedAdapters.";
    case "DisputeDoesNotExist":
    case "UnknownDispute":
      return "The court does not know this dispute.";
    default:
      return null;
  }
}

/** A plain-language reason for any error thrown by a read, a simulation or a wallet. */
export function describeError(error: unknown, context: ErrorContext = {}): string {
  const revert = findRevert(error);
  if (revert) {
    const text = describeRevert(revert, context);
    if (text) return text;
    return `The transaction could not go through.\nIt reverted with ${revert.errorName}.`;
  }
  if (error instanceof BaseError) {
    const rejected = error.walk(
      (e) => (e as { code?: number }).code === 4001 || (e as BaseError).name === "UserRejectedRequestError",
    );
    if (rejected) return "You rejected the request in your wallet.";
    const unreachable = error.walk((e) => (e as BaseError).name === "HttpRequestError");
    if (unreachable) return "The local devnet does not answer. Start it with `yarn devnet` and reload.";
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Puts a situation sentence in front of a message, keeping the message's technical detail after the first newline. */
export function withLead(lead: string, message: string): string {
  if (message.startsWith(CANCELLED_BEFORE_SENDING) || message.startsWith(MINED_REVERT)) return message;
  const [first, ...rest] = message.split("\n");
  return [`${lead} ${first}`, ...rest].join("\n");
}

export const CANCELLED_BEFORE_SENDING = "Cancelled before sending.";
export const MINED_REVERT = "Transaction failed: network gas may have been used.";

/** An Error whose message is already plain language, so the UI can show `error.message` as is. */
export class SwitchError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "SwitchError";
  }
}

export function toSwitchError(error: unknown, context: ErrorContext = {}): SwitchError {
  if (error instanceof SwitchError) return error;
  return new SwitchError(describeError(error, context), error);
}
