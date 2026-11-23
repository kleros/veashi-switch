// Public RPCs cap eth_getLogs (a block span, a result size, or both), and the caps differ per provider (Base Sepolia's
// own RPC allows 200 blocks, publicnode 50,000, drpc's free plan 10,000). This reads events over a block range in as
// few calls as the RPC allows: in chunks of the limit an error states, else halving the range whenever it is refused.
// Reads up to the head are cached per query, so polling the same query only reads the blocks since the last read.
import type { Abi, ContractEventName, GetContractEventsParameters, GetContractEventsReturnType, PublicClient } from "viem";

const LIMIT_MESSAGE =
  /block range|range is too (large|wide)|range too (large|wide)|exceed|limit|too many|query returned more than|response size|result window|too large|too big|max(imum)? (range|block)|ranges? over [\d,]+ blocks/i;
// The span an error states, for the wordings that name one: "limited to a 200 range", "exceed maximum block range:
// 50000", "ranges over 10000 blocks are not supported", "block range ... up to 2000 blocks".
const STATED_SPAN = [
  /limited to (?:a )?([\d,]+)(?:[- ]block)? range/i,
  /maximum block range:?\s*([\d,]+)/i,
  /ranges? over ([\d,]+) blocks/i,
  /up to ([\d,]+) blocks/i,
];
const LIMIT_CODES = new Set([-32005, -32602, -32614]);
const RATE_LIMIT_MESSAGE = /rate.?limit|too many requests|429/i;

/** True for the errors RPCs return when a getLogs range or result is too big (as opposed to a real failure). */
export function isRangeLimitError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 6; depth++) {
    if (typeof e !== "object") return false;
    const { code, status, message, shortMessage, details, cause } = e as Record<string, unknown>;
    if (status === 413 || (typeof code === "number" && LIMIT_CODES.has(code))) return true;
    const text = [message, shortMessage, details].filter((m): m is string => typeof m === "string").join("\n");
    if (RATE_LIMIT_MESSAGE.test(text)) return false; // a rate limit is not fixed by smaller ranges
    if (LIMIT_MESSAGE.test(text)) return true;
    e = cause;
  }
  return false;
}

/** The block span an RPC's limit error states, or null. */
export function statedSpan(error: unknown): bigint | null {
  for (let e: unknown = error, depth = 0; e && depth < 6; depth++) {
    if (typeof e !== "object") return null;
    const { message, shortMessage, details, cause } = e as Record<string, unknown>;
    for (const text of [details, shortMessage, message]) {
      if (typeof text !== "string") continue;
      for (const re of STATED_SPAN) {
        const m = re.exec(text);
        const n = m ? BigInt(m[1].replace(/,/g, "")) : 0n;
        if (n > 0n) return n;
      }
    }
    e = cause;
  }
  return null;
}

// Per client, once its RPC has refused a span: the widest span known to work since, so later calls start with chunks
// of that size instead of failing first. Never set for an RPC that has refused nothing: it gets whole ranges.
const learnedSpan = new WeakMap<object, bigint>();

// Per client, per query: the logs read from fromBlock up to toBlock. The last REORG_BLOCKS blocks are read again on the
// next call, so a reorganised tail is replaced; a head below toBlock (a restarted devnet) drops the entry.
const queryCache = new WeakMap<object, Map<string, { fromBlock: bigint; toBlock: bigint; logs: unknown[] }>>();
const REORG_BLOCKS = 32n;

const queryKey = (params: object) =>
  JSON.stringify(params, (k, v) => (k === "abi" ? undefined : typeof v === "bigint" ? v.toString() : v));

type PagedParameters<abi extends Abi | readonly unknown[], eventName, strict> = Omit<
  GetContractEventsParameters<abi, eventName extends ContractEventName<abi> | undefined ? eventName : undefined, strict extends boolean | undefined ? strict : undefined>,
  "fromBlock" | "toBlock" | "blockHash"
>;

/**
 * client.getContractEvents over fromBlock..toBlock (latest when omitted), split into smaller ranges when the RPC
 * refuses the span. Logs come back in block order. Errors that are not range limits, and a limit error on a single
 * block, are rethrown.
 */
export async function getContractEventsPaged<
  const abi extends Abi | readonly unknown[],
  eventName extends ContractEventName<abi> | undefined = undefined,
  strict extends boolean | undefined = undefined,
>(
  client: PublicClient,
  params: PagedParameters<abi, eventName, strict>,
  range: { fromBlock: bigint; toBlock?: bigint },
): Promise<GetContractEventsReturnType<abi, eventName, strict, bigint, bigint>> {
  type Logs = GetContractEventsReturnType<abi, eventName, strict, bigint, bigint>;
  // Uncached: viem caches the block number for the client's polling interval (4 s in a browser), and a read right
  // after a receipt must include that receipt's block.
  const toBlock = range.toBlock ?? (await client.getBlockNumber({ cacheTime: 0 }));
  if (range.toBlock !== undefined) return (await readRange(client, params, range.fromBlock, toBlock)) as Logs;

  let cache = queryCache.get(client);
  if (!cache) queryCache.set(client, (cache = new Map()));
  const key = queryKey(params);
  const cached = cache.get(key);
  let logs: unknown[];
  if (cached && cached.fromBlock === range.fromBlock && cached.toBlock <= toBlock) {
    const tail = cached.toBlock - REORG_BLOCKS + 1n;
    const resume = tail > range.fromBlock ? tail : range.fromBlock;
    const kept = cached.logs.filter((l) => (l as { blockNumber: bigint }).blockNumber < resume);
    logs = [...kept, ...(await readRange(client, params, resume, toBlock))];
  } else {
    logs = await readRange(client, params, range.fromBlock, toBlock);
  }
  cache.set(key, { fromBlock: range.fromBlock, toBlock, logs });
  return [...logs] as Logs;
}

/** The logs of fromBlock..toBlock in block order, in as few calls as the RPC allows. */
async function readRange(client: PublicClient, params: object, fromBlock: bigint, toBlock: bigint): Promise<unknown[]> {
  const out: unknown[] = [];

  const fetchRange = async (from: bigint, to: bigint): Promise<void> => {
    try {
      // The generic parameters cannot be threaded through client.getContractEvents's overloads here; the result
      // type is restored by the cast at the return.
      const logs: unknown[] = await (client.getContractEvents as (p: unknown) => Promise<unknown[]>)({
        ...params,
        fromBlock: from,
        toBlock: to,
      });
      const span = to - from + 1n;
      const known = learnedSpan.get(client);
      if (known !== undefined && span > known) learnedSpan.set(client, span);
      out.push(...logs);
    } catch (e) {
      if (from >= to || !isRangeLimitError(e)) throw e;
      const stated = statedSpan(e);
      if (stated !== null && stated < to - from + 1n) {
        // The RPC says how much it allows: read the range in chunks of that size.
        const known = learnedSpan.get(client);
        if (known === undefined || known > stated) learnedSpan.set(client, stated);
        for (let start = from; start <= to; start += stated) await fetchRange(start, start + stated - 1n < to ? start + stated - 1n : to);
        return;
      }
      const mid = from + (to - from) / 2n;
      const half = mid - from + 1n;
      const known = learnedSpan.get(client);
      if (known === undefined || known > half) learnedSpan.set(client, half);
      await fetchRange(from, mid);
      await fetchRange(mid + 1n, to);
    }
  };

  const chunk = learnedSpan.get(client);
  if (chunk === undefined || chunk <= 0n) {
    await fetchRange(fromBlock, toBlock);
  } else {
    for (let from = fromBlock; from <= toBlock; from += chunk) {
      const to = from + chunk - 1n < toBlock ? from + chunk - 1n : toBlock;
      await fetchRange(from, to);
    }
  }
  return out;
}
