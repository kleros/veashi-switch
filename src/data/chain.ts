// The chain-backed SwitchData: viem public clients read both chains (the local devnet or the public testnets), the
// wagmi config's connected wallet writes (the request on the foreign chain; `act` on whichever chain the step runs
// on), and on the devnet `devnet.rule` gives the court's ruling with the anvil dev account on the home chain.
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  zeroAddress,
  type PublicClient,
} from "viem";
import type { Config } from "wagmi";
import { getAccount, switchChain, writeContract } from "wagmi/actions";
import {
  adapterAbi,
  allErrorsAbi,
  erc20Abi,
  foreignGatewayAbi,
  homeGatewayAbi,
  lightbulbAbi,
  reporterAbi,
  rulerAbi,
  yahoAbi,
  yaruAbi,
} from "./abi";
import { explorerTxUrl, type ParsedDevnetEnv } from "./env";
import { getContractEventsPaged } from "./logs";
import { viemChains } from "./networks";
import { CANCELLED_BEFORE_SENDING, describeError, MINED_REVERT, SwitchError, toSwitchError, withLead, type ErrorContext } from "./errors";
import { buildRequest, isFinal, projectTo, stageSteps, type LegFacts, type RequestFacts } from "./lifecycle";
import { assembleQuote, decodeCourtAndJurors } from "./quote";
import { normalizeSelection, validateSelection } from "./selection";
import type {
  Address,
  ChainInfo,
  CostQuote,
  Hex,
  Oracle,
  OracleSelection,
  PayToken,
  RequestAction,
  SwitchData,
  SwitchRequest,
  Unsubscribe,
} from "./types";

/** anvil's first well-known dev account (mnemonic "test test ... junk"): governor, ruler and test wallet. */
export const DEV_ACCOUNT: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

export const WATCH_INTERVAL_MS = 1000;
const POLL_MS = { devnet: 250, testnet: 2000 }; // receipt polling: anvil answers at once, public RPCs are rate-limited
const READ_BACK_ATTEMPTS = 5; // extra reads of a mined request before reporting that it cannot be read back
const TESTNET_WATCH_INTERVAL_MS = 6000;

/** The two chains as viem chains (kept under this name for the devnet scripts). */
export const devnetChains = viemChains;

/** The lightbulb call for a selection and token: the right overload and the value to send. */
export function requestCall(
  selection: OracleSelection | null,
  token: PayToken,
  total: bigint,
  usdc: Address,
):
  | { functionName: "requestSwitch"; args: [] | [bigint[], bigint]; value: bigint }
  | { functionName: "requestSwitchWithToken"; args: [Address] | [bigint[], bigint, Address]; value: 0n } {
  const custom = selection ? ([selection.oracleIds.map(BigInt), BigInt(selection.threshold)] as [bigint[], bigint]) : null;
  if (token === "native") return { functionName: "requestSwitch", args: custom ?? [], value: total };
  return { functionName: "requestSwitchWithToken", args: custom ? [...custom, usdc] : [usdc], value: 0n };
}

interface OracleWiring {
  oracle: Oracle;
  disputeAdapter: Address; // dispute leg, on the home chain
  rulingAdapter: Address; // ruling leg, on the foreign chain
}

type Message = {
  nonce: bigint;
  targetChainId: bigint;
  threshold: bigint;
  sender: Address;
  receiver: Address;
  data: Hex;
  reporters: readonly Address[];
  adapters: readonly Address[];
};

type DisputeMessage = {
  foreignArbitrable: Address;
  foreignDisputeID: bigint;
  choices: bigint;
  extraData: Hex;
  externalDisputeID: bigint;
  templateId: bigint;
  templateUri: string;
  oracleIDs: readonly bigint[];
  threshold: bigint;
};

/** What `act` needs besides the facts: the messages and the hash each step is called with. */
interface Handles {
  disputeHash: Hex | null;
  disputeMessage: DisputeMessage | null; // HomeGateway DisputeReceived: createReceivedDispute takes it back
  disputeLeg: Message | null; // the dispute leg's Yaho message, for Yaru.executeMessages on the home chain
  returnLeg: Message | null; // the return leg's (ruling or creation failure), for Yaru.executeMessages on the foreign chain
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const ZERO_HASH = `0x${"0".repeat(64)}`;

// The Veashi SDK reporters name their bridge in PROVIDER(); the devnet mocks and older reporters in name().
const PROVIDER_NAMES: Record<string, string> = {
  vea: "Vea",
  ccip: "CCIP",
  layerzero: "LayerZero",
  lz: "LayerZero",
  debridge: "deBridge",
  axelar: "Axelar",
};
export const oracleDisplayName = (raw: string) => PROVIDER_NAMES[raw.toLowerCase()] ?? raw;

/** The SwitchError for a failure; before anything was sent it leads with "Cancelled before sending.". */
export function toFailure(error: unknown, beforeSending: boolean, context: ErrorContext): SwitchError {
  const switched = toSwitchError(error, context);
  if (!beforeSending || error instanceof SwitchError) return switched;
  return new SwitchError(withLead(CANCELLED_BEFORE_SENDING, switched.message), error);
}

export interface RuleDeps {
  request: (disputeId: bigint) => Promise<{ homeDisputeId: bigint | null; ruling: number } | null>;
  simulate: (args: readonly [bigint, bigint, boolean, boolean]) => Promise<unknown>;
  write: (args: readonly [bigint, bigint, boolean, boolean]) => Promise<Hex>;
  waitForReceipt: (hash: Hex) => Promise<{ status: string }>;
  fail: (error: unknown, beforeSending?: boolean) => Promise<never>;
}

/** devnet.rule's logic with its I/O injected, so tests can fake each step. */
export async function runRule(deps: RuleDeps, disputeId: bigint, ruling: 1 | 2): Promise<Hex> {
  let sent = false;
  try {
    const current = await deps.request(disputeId);
    if (!current) throw new SwitchError(`${CANCELLED_BEFORE_SENDING} Dispute #${disputeId} does not exist on the devnet.`);
    if (current.homeDisputeId === null) {
      throw new SwitchError(
        `${CANCELLED_BEFORE_SENDING} The dispute has not reached Kleros Court yet: wait until it is received on the home chain.`,
      );
    }
    if (current.ruling !== 0) throw new SwitchError(`${CANCELLED_BEFORE_SENDING} This dispute already has a ruling.`);
    const args = [current.homeDisputeId, BigInt(ruling), false, false] as const;
    await deps.simulate(args);
    const hash = await deps.write(args);
    sent = true;
    const receipt = await deps.waitForReceipt(hash);
    if (receipt.status !== "success") throw new SwitchError(`${MINED_REVERT}\nThe ruling transaction ${hash} reverted.`);
    return hash;
  } catch (error) {
    return deps.fail(error, !sent);
  }
}

export function createChainSwitchData(env: ParsedDevnetEnv, config: Config): SwitchData {
  const chains = devnetChains(env);
  const pollingInterval = POLL_MS[env.kind];
  const foreign = createPublicClient({ chain: chains.foreign, transport: http(env.foreign.rpcUrl), pollingInterval }) as PublicClient;
  const home = createPublicClient({ chain: chains.home, transport: http(env.home.rpcUrl), pollingInterval }) as PublicClient;
  const watchInterval = env.kind === "devnet" ? WATCH_INTERVAL_MS : TESTNET_WATCH_INTERVAL_MS;
  const fa = env.addresses.foreign;
  const ha = env.addresses.home;
  const lightbulb = fa.GatewayLightbulb;
  const gateway = fa.ForeignGateway;
  const usdc = fa.USDC;

  const info = (key: "foreign" | "home"): ChainInfo => ({
    key,
    network: env.kind,
    id: env[key].chainId,
    name: env[key].name,
    rpcUrl: env[key].rpcUrl,
    explorerTxUrl: env[key].explorerUrl ? (hash: Hex) => explorerTxUrl(env[key], hash)! : null,
  });
  const clients = { foreign, home };

  // The Yaru each gateway accepts messages from: read from the gateways rather than trusted from the config.
  let yaruCache: Promise<{ foreign: Address; home: Address }> | null = null;
  const yarus = () => {
    yaruCache ??= Promise.all([
      foreign.readContract({ address: gateway, abi: foreignGatewayAbi, functionName: "yaru" }),
      home.readContract({ address: ha.HomeGateway, abi: homeGatewayAbi, functionName: "yaru" }),
    ])
      .then(([f, h]) => ({ foreign: f, home: h }))
      .catch((e) => {
        yaruCache = null;
        throw e;
      });
    return yaruCache;
  };

  let wiringCache: Promise<OracleWiring[]> | null = null;
  const wiring = (): Promise<OracleWiring[]> => {
    wiringCache ??= readWiring().catch((e) => {
      wiringCache = null;
      throw e;
    });
    return wiringCache;
  };

  async function readWiring(): Promise<OracleWiring[]> {
    const count = Number(await foreign.readContract({ address: gateway, abi: foreignGatewayAbi, functionName: "oracleCount" }));
    return Promise.all(
      Array.from({ length: count }, async (_, id) => {
        const [reporter, disputeAdapter, rulingAdapter, enabled] = await foreign.readContract({
          address: gateway,
          abi: foreignGatewayAbi,
          functionName: "oracles",
          args: [BigInt(id)],
        });
        const cost = await foreign.readContract({
          address: gateway,
          abi: foreignGatewayAbi,
          functionName: "oracleBridgingCost",
          args: [BigInt(id)],
        });
        let name = `Oracle #${id}`;
        if (reporter !== zeroAddress) {
          name = await foreign
            .readContract({ address: reporter, abi: reporterAbi, functionName: "name" })
            .catch(() => foreign.readContract({ address: reporter, abi: reporterAbi, functionName: "PROVIDER" }))
            .then(oracleDisplayName)
            .catch(() => name);
        }
        const label = name.charAt(0).toUpperCase() + name.slice(1);
        return {
          oracle: { id, name, via: `${label}Reporter · ${label}Adapter`, enabled, bridgingCostWei: cost },
          disputeAdapter,
          rulingAdapter,
        };
      }),
    );
  }

  const errorContext = async (): Promise<ErrorContext> => {
    const oracles = await wiring().catch(() => [] as OracleWiring[]);
    return {
      homeChainName: env.home.name,
      network: env.kind ?? "devnet",
      oracleName: (id) => oracles.find((w) => w.oracle.id === id)?.oracle.name ?? `Oracle #${id}`,
    };
  };
  const fail = async (error: unknown, beforeSending = false): Promise<never> => {
    throw toFailure(error, beforeSending, await errorContext());
  };

  let extraDataCache: Promise<Hex> | null = null;
  const extraData = () =>
    (extraDataCache ??= foreign.readContract({ address: lightbulb, abi: lightbulbAbi, functionName: "arbitratorExtraData" }));

  async function defaultSelection(): Promise<OracleSelection> {
    const { oracleIDs, threshold } = await foreign.readContract({
      address: gateway,
      abi: foreignGatewayAbi,
      functionName: "getDefaultOracles",
    });
    return { oracleIds: oracleIDs.map(Number), threshold: Number(threshold) };
  }

  async function quote(selection: OracleSelection | null, token: PayToken): Promise<CostQuote> {
    const sel = selection ? normalizeSelection(selection) : null;
    const data = await extraData();
    const oracleIds = sel ? sel.oracleIds : (await defaultSelection()).oracleIds;
    const ids = oracleIds.map(BigInt);
    const read = <T>(functionName: string, args: readonly unknown[]) =>
      foreign.readContract({ address: gateway, abi: foreignGatewayAbi, functionName, args } as never) as Promise<T>;

    let total: bigint;
    if (token === "native") total = sel ? await read("arbitrationCost", [data, ids]) : await read("arbitrationCost", [data]);
    else total = sel ? await read("arbitrationCost", [data, ids, usdc]) : await read("arbitrationCost", [data, usdc]);

    let { courtId, jurors } = decodeCourtAndJurors(data);
    let feeForJuror = await read<bigint>("feeForJuror", [courtId]);
    if (feeForJuror === 0n && courtId !== 0n) {
      courtId = 0n;
      feeForJuror = await read<bigint>("feeForJuror", [0n]);
    }
    const homeNativeRate = await read<bigint>("homeNativeRate", []);
    const bridgingCosts: Record<number, bigint> = {};
    for (const id of oracleIds) bridgingCosts[id] = await read<bigint>("oracleBridgingCost", [BigInt(id)]);

    let decimals = 18;
    let symbol = "ETH";
    let toToken = (amount: bigint) => amount;
    if (token === "usdc") {
      const [rateAccepted, rateInEth, rateDecimals] = await read<[boolean, bigint, number]>("currencyRates", [usdc]);
      void rateAccepted;
      decimals = await foreign.readContract({ address: usdc, abi: erc20Abi, functionName: "decimals" });
      symbol = await foreign.readContract({ address: usdc, abi: erc20Abi, functionName: "symbol" });
      // ForeignGateway.convertEthToTokenAmount, computed locally to avoid one call per line.
      toToken = (amount: bigint) => (amount * 10n ** BigInt(rateDecimals)) / rateInEth;
    }
    return assembleQuote({
      selection: sel,
      oracleIds,
      token,
      feeForJuror,
      jurors,
      homeNativeRate,
      bridgingCosts,
      toToken,
      total,
      decimals,
      symbol,
    });
  }

  async function reportsOf(
    key: "foreign" | "home",
    messageId: bigint,
    adapters: { oracleId: number; adapter: Address }[],
    fromBlock: bigint,
  ): Promise<LegFacts["reports"]> {
    const logs = await getContractEventsPaged(clients[key], {
      address: adapters.map((a) => a.adapter),
      abi: adapterAbi,
      eventName: "HashStored",
      args: { id: messageId },
    }, { fromBlock });
    return adapters.map(({ oracleId, adapter }) => ({
      oracleId,
      txHash: logs.find((l) => sameAddress(l.address, adapter))?.transactionHash ?? null,
    }));
  }

  /** One leg's facts, and its Yaho message (what Yaru.executeMessages takes on the target chain). */
  async function legFacts(
    from: "foreign" | "home",
    dispatchTx: Hex,
    messageId: bigint,
    adapters: { oracleId: number; adapter: Address }[],
    threshold: number,
    since: Record<"foreign" | "home", bigint>,
  ): Promise<{ leg: LegFacts; message: Message | null }> {
    const to = from === "foreign" ? "home" : "foreign";
    const target = clients[to];
    const yaru = (await yarus())[to];
    const receipt = await clients[from].getTransactionReceipt({ hash: dispatchTx });
    const dispatched = parseEventLogs({ abi: yahoAbi, logs: receipt.logs, eventName: "MessageDispatched" }).find(
      (l) => l.args.messageId === messageId,
    );
    const message = (dispatched?.args.message as Message | undefined) ?? null;
    const reports = await reportsOf(to, messageId, adapters, since[to]);
    const executed = await getContractEventsPaged(target, {
      address: yaru,
      abi: yaruAbi,
      eventName: "MessageExecuted",
      args: { messageId },
    }, { fromBlock: since[to] });
    const executedTx = executed[0]?.transactionHash ?? null;
    let failure: string | null = null;
    let executable = false;
    const reported = reports.filter((r) => r.txHash).length;
    if (!executedTx && message && reported >= threshold) {
      // Enough oracles reported but nothing executed yet: simulate the execution to see whether it would revert.
      try {
        await target.simulateContract({
          address: yaru,
          abi: [...yaruAbi, ...allErrorsAbi],
          functionName: "executeMessages",
          args: [[message]],
          account: DEV_ACCOUNT,
        });
        executable = true;
      } catch (error) {
        const text = describeError(error, await errorContext());
        // A race with a keeper executing it right now is not a failure.
        if (text !== describeError({ data: { errorName: "MessageIdAlreadyExecuted", args: [] } })) failure = text;
      }
    }
    return { leg: { messageId, dispatchTx, reports, executedTx, failure, executable }, message };
  }

  async function readRequest(disputeId: bigint): Promise<{ facts: RequestFacts; handles: Handles } | null> {
    const requested = await getContractEventsPaged(foreign, {
      address: lightbulb,
      abi: lightbulbAbi,
      eventName: "LightbulbRequested",
      args: { _disputeID: disputeId },
    }, { fromBlock: env.foreign.fromBlock });
    const log = requested[0];
    if (!log) return null;
    // Everything after the request happens at or after its block on the foreign chain. Starting the foreign reads there
    // keeps them short on an RPC that allows only small getLogs ranges (Base Sepolia's own allows 200 blocks).
    const since = { foreign: log.blockNumber, home: env.home.fromBlock };
    const oracles = await wiring();
    const receipt = await foreign.getTransactionReceipt({ hash: log.transactionHash });
    const block = await foreign.getBlock({ blockNumber: receipt.blockNumber });
    const relayed = parseEventLogs({ abi: foreignGatewayAbi, logs: receipt.logs, eventName: "DisputeRelayed" })[0];
    const owner = log.args._owner as Address;
    const now = Date.now();

    const facts: RequestFacts = {
      disputeId,
      owner,
      selection: { oracleIds: [], threshold: 0 },
      paid: { token: "native", amount: 0n },
      requestTx: log.transactionHash,
      requestedAt: Number(block.timestamp) * 1000,
      dispute: null,
      delivered: null,
      created: null,
      creationBlocker: null,
      creationFailure: null,
      ruling: null,
      rulingLeg: null,
      switched: null,
      closed: null,
      refund: null,
      refundPending: false,
      homeTime: now,
      updatedAt: now,
    };
    const handles: Handles = { disputeHash: null, disputeMessage: null, disputeLeg: null, returnLeg: null };
    if (!relayed) return { facts, handles };

    const { _disputeHash: disputeHash, _messageId: messageId } = relayed.args;
    handles.disputeHash = disputeHash;
    const chosen = await foreign.readContract({
      address: gateway,
      abi: foreignGatewayAbi,
      functionName: "getDisputeOracles",
      args: [disputeHash],
    });
    const selection = { oracleIds: chosen.oracleIDs.map(Number), threshold: Number(chosen.threshold) };
    facts.selection = selection;
    const data = await foreign.readContract({
      address: gateway,
      abi: foreignGatewayAbi,
      functionName: "disputeHashtoDisputeData",
      args: [disputeHash],
    });
    const [, , , , feeToken, feesForJurors, feesForBridging] = data;
    const token: PayToken = sameAddress(feeToken, usdc) ? "usdc" : "native";
    facts.paid = { token, amount: feesForJurors + feesForBridging };
    const wire = (id: number) => oracles.find((w) => w.oracle.id === id);
    const adapters = (side: "disputeAdapter" | "rulingAdapter") =>
      selection.oracleIds.map((oracleId) => ({ oracleId, adapter: wire(oracleId)?.[side] ?? zeroAddress }));

    const disputeLeg = await legFacts("foreign", log.transactionHash, messageId, adapters("disputeAdapter"), selection.threshold, since);
    facts.dispute = disputeLeg.leg;
    handles.disputeLeg = disputeLeg.message;

    const received = await home.readContract({
      address: ha.HomeGateway,
      abi: homeGatewayAbi,
      functionName: "getReceivedDispute",
      args: [disputeHash],
    });
    if (received.receivedAt === 0n) return { facts, handles };
    const timeout = await home.readContract({ address: ha.HomeGateway, abi: homeGatewayAbi, functionName: "creationTimeout" });
    facts.homeTime = Number((await home.getBlock()).timestamp) * 1000;
    facts.delivered = { at: Number(received.receivedAt) * 1000, failableAt: Number(received.receivedAt + timeout) * 1000 };

    // The dispute's return leg, its message, and the foreign-chain events that close the request.
    const returnLeg = async (dispatchTx: Hex, returnMessageId: bigint) => {
      const back = await legFacts("home", dispatchTx, returnMessageId, adapters("rulingAdapter"), selection.threshold, since);
      facts.rulingLeg = back.leg;
      handles.returnLeg = back.message;
    };

    if (received.created) {
      const homeDisputeId = await home.readContract({
        address: ha.HomeGateway,
        abi: homeGatewayAbi,
        functionName: "disputeHashtoID",
        args: [disputeHash],
      });
      const incoming = await getContractEventsPaged(home, {
        address: ha.HomeGateway,
        abi: homeGatewayAbi,
        eventName: "CrossChainDisputeIncoming",
        args: { _arbitrable: lightbulb, _arbitrableDisputeID: disputeId, _arbitratorDisputeID: homeDisputeId },
      }, { fromBlock: env.home.fromBlock });
      facts.created = { tx: incoming[0]?.transactionHash ?? null, homeDisputeId };
      const dispatched = await getContractEventsPaged(home, {
        address: ha.HomeGateway,
        abi: homeGatewayAbi,
        eventName: "RulingDispatched",
        args: { _disputeHash: disputeHash },
      }, { fromBlock: env.home.fromBlock });
      const rulingLog = dispatched[0];
      if (rulingLog) {
        facts.ruling = { value: rulingLog.args._ruling as bigint, tx: rulingLog.transactionHash };
        await returnLeg(rulingLog.transactionHash, rulingLog.args._messageId as bigint);
        const switchedLogs = await getContractEventsPaged(foreign, {
          address: lightbulb,
          abi: lightbulbAbi,
          eventName: "LightbulbSwitched",
          args: { _disputeID: disputeId },
        }, { fromBlock: since.foreign });
        if (switchedLogs[0]) facts.switched = { tx: switchedLogs[0].transactionHash };
      }
      return { facts, handles };
    }

    if (!received.creationFailed) {
      // Delivered, not created: what createReceivedDispute is called with, and whether it would go through now.
      const deliveredLogs = await getContractEventsPaged(home, {
        address: ha.HomeGateway,
        abi: homeGatewayAbi,
        eventName: "DisputeReceived",
        args: { _disputeHash: disputeHash },
      }, { fromBlock: env.home.fromBlock });
      const message = (deliveredLogs[0]?.args._message as DisputeMessage | undefined) ?? null;
      handles.disputeMessage = message;
      if (!message) {
        facts.creationBlocker = "The delivered dispute cannot be found on the home chain yet.";
      } else {
        try {
          await home.simulateContract({
            address: ha.HomeGateway,
            abi: [...homeGatewayAbi, ...allErrorsAbi],
            functionName: "createReceivedDispute",
            args: [message],
            account: DEV_ACCOUNT,
          });
        } catch (error) {
          facts.creationBlocker = describeError(error, await errorContext());
        }
      }
      return { facts, handles };
    }

    // Not created in time: the failure went back over the same oracles.
    const failedLogs = await getContractEventsPaged(home, {
      address: ha.HomeGateway,
      abi: homeGatewayAbi,
      eventName: "DisputeCreationFailed",
      args: { _disputeHash: disputeHash },
    }, { fromBlock: env.home.fromBlock });
    const failedLog = failedLogs[0];
    if (!failedLog) return { facts, handles };
    facts.creationFailure = { tx: failedLog.transactionHash };
    await returnLeg(failedLog.transactionHash, failedLog.args._messageId as bigint);
    const closedLogs = await getContractEventsPaged(foreign, {
      address: lightbulb,
      abi: lightbulbAbi,
      eventName: "LightbulbRequestFailed",
      args: { _disputeID: disputeId },
    }, { fromBlock: since.foreign });
    if (!closedLogs[0]) return { facts, handles };
    facts.closed = { tx: closedLogs[0].transactionHash };
    const refundLogs = await getContractEventsPaged(foreign, {
      address: gateway,
      abi: foreignGatewayAbi,
      eventName: "DisputeCreationFailed",
      args: { _disputeID: disputeId },
    }, { fromBlock: since.foreign });
    const claimedLogs = await getContractEventsPaged(foreign, {
      address: gateway,
      abi: foreignGatewayAbi,
      eventName: "RefundClaimed",
      args: { _disputeID: disputeId },
    }, { fromBlock: since.foreign });
    const owed = refundLogs[0]?.args;
    const claimed = claimedLogs[0];
    facts.refund = {
      token: owed?._feeToken && sameAddress(owed._feeToken, usdc) ? "usdc" : token,
      amount: (owed?._amount as bigint | undefined) ?? feesForJurors,
      claimed: claimed ? { tx: claimed.transactionHash, beneficiary: claimed.args._beneficiary as Address } : null,
    };
    const pending = await foreign.readContract({
      address: gateway,
      abi: foreignGatewayAbi,
      functionName: "pendingRefunds",
      args: [disputeId],
    });
    facts.refundPending = pending !== ZERO_HASH;
    return { facts, handles };
  }

  async function request(disputeId: bigint): Promise<SwitchRequest | null> {
    try {
      const read = await readRequest(disputeId);
      if (!read) return null;
      const ctx = await errorContext();
      return buildRequest(read.facts, ctx.oracleName);
    } catch (error) {
      return fail(error);
    }
  }

  /** The contract call behind one action, on the chain it runs on. */
  function actionCall(action: RequestAction, disputeId: bigint, handles: Handles, yaru: { foreign: Address; home: Address }) {
    const missing = (what: string): never => {
      throw new SwitchError(`${CANCELLED_BEFORE_SENDING} This step is not due: ${what} cannot be found on the chain.`);
    };
    switch (action) {
      case "deliver":
        return {
          chain: "home" as const,
          address: yaru.home,
          abi: yaruAbi,
          functionName: "executeMessages",
          args: [[handles.disputeLeg ?? missing("the request's message")]],
        };
      case "create-dispute":
        return {
          chain: "home" as const,
          address: ha.HomeGateway,
          abi: homeGatewayAbi,
          functionName: "createReceivedDispute",
          args: [handles.disputeMessage ?? missing("the delivered dispute")],
        };
      case "send-failure":
        return {
          chain: "home" as const,
          address: ha.HomeGateway,
          abi: homeGatewayAbi,
          functionName: "sendCreationFailure",
          args: [handles.disputeHash ?? missing("the dispute")],
        };
      case "deliver-back":
        return {
          chain: "foreign" as const,
          address: yaru.foreign,
          abi: yaruAbi,
          functionName: "executeMessages",
          args: [[handles.returnLeg ?? missing("the returning message")]],
        };
      case "execute-ruling":
        return { chain: "foreign" as const, address: gateway, abi: foreignGatewayAbi, functionName: "executeRuling", args: [disputeId] };
      case "claim-refund":
        return { chain: "foreign" as const, address: lightbulb, abi: lightbulbAbi, functionName: "claimRefund", args: [disputeId] };
    }
  }

  async function act(disputeId: bigint, action: RequestAction): Promise<Hex> {
    let sent = false;
    try {
      const read = await readRequest(disputeId);
      if (!read) throw new SwitchError(`${CANCELLED_BEFORE_SENDING} Request #${disputeId} does not exist.`);
      const current = buildRequest(read.facts);
      if (!current.actions.includes(action)) {
        throw new SwitchError(`${CANCELLED_BEFORE_SENDING} This step is no longer due: refresh the status.`);
      }
      const { chain, ...call } = actionCall(action, disputeId, read.handles, await yarus());
      const account = await connectedAccount(chain);
      await clients[chain].simulateContract({ ...call, abi: [...call.abi, ...allErrorsAbi], account } as never);
      const hash = await writeContract(config, { ...call, chainId: env[chain].chainId } as never);
      sent = true;
      const receipt = await clients[chain].waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new SwitchError(`${MINED_REVERT}\nThe transaction ${hash} reverted.`);
      return hash;
    } catch (error) {
      return fail(error, !sent);
    }
  }

  /** The connected wallet, switched to the chain the next transaction runs on. */
  async function connectedAccount(chain: "foreign" | "home" = "foreign"): Promise<Address> {
    const account = getAccount(config);
    if (account.status !== "connected" || !account.address) throw new SwitchError(`${CANCELLED_BEFORE_SENDING} Connect a wallet first.`);
    if (account.chainId !== env[chain].chainId) {
      await switchChain(config, { chainId: env[chain].chainId });
    }
    return account.address;
  }

  async function usdcAllowance(owner: Address): Promise<bigint> {
    return foreign.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [owner, lightbulb] });
  }

  async function approveUsdc(amount: bigint): Promise<Hex> {
    let sent = false;
    try {
      const account = await connectedAccount();
      await foreign.simulateContract({
        address: usdc,
        abi: [...erc20Abi, ...allErrorsAbi],
        functionName: "approve",
        args: [lightbulb, amount],
        account,
      });
      const hash = await writeContract(config, {
        address: usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [lightbulb, amount],
        chainId: env.foreign.chainId,
      });
      sent = true;
      const receipt = await foreign.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new SwitchError(`${MINED_REVERT}\nThe USDC approval transaction ${hash} reverted.`);
      }
      return hash;
    } catch (error) {
      return fail(error, !sent);
    }
  }

  async function requestSwitch(selection: OracleSelection | null, token: PayToken): Promise<SwitchRequest> {
    let sent = false;
    try {
      const sel = selection ? normalizeSelection(selection) : null;
      if (sel) {
        const invalid = validateSelection(sel, (await wiring()).map((w) => w.oracle));
        if (invalid?.kind === "empty") throw new SwitchError(`${CANCELLED_BEFORE_SENDING} Choose at least one oracle.`);
        if (invalid?.kind === "threshold-too-high") {
          throw new SwitchError(
            `${CANCELLED_BEFORE_SENDING} The agreement threshold (${invalid.threshold}) must be between 1 and the number of oracles selected (${invalid.selected}).`,
          );
        }
        if (invalid?.kind === "disabled-oracle") {
          throw new SwitchError(
            `${CANCELLED_BEFORE_SENDING} An oracle is not available. Choose other oracles.\nOracle #${invalid.oracleId} is not enabled on the gateway.`,
          );
        }
      }
      const account = await connectedAccount();
      const { total } = await quote(sel, token);
      if (token === "usdc" && (await usdcAllowance(account)) < total) await approveUsdc(total);

      const call = requestCall(sel, token, total, usdc);
      const abi = [...lightbulbAbi, ...allErrorsAbi];
      await foreign.simulateContract({ address: lightbulb, abi, ...call, account } as never);
      const hash = await writeContract(config, {
        address: lightbulb,
        abi: lightbulbAbi,
        ...call,
        chainId: env.foreign.chainId,
      } as never);
      sent = true;
      const receipt = await foreign.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new SwitchError(`${MINED_REVERT}\nThe request transaction ${hash} reverted.`);
      }
      const requested = parseEventLogs({ abi: lightbulbAbi, logs: receipt.logs, eventName: "LightbulbRequested" })[0];
      if (!requested) throw new SwitchError("The request was mined but the Lightbulb emitted no LightbulbRequested event.");
      // A public RPC may route the read to a node behind the one that returned the receipt: retry briefly.
      let built = await request(requested.args._disputeID);
      for (let attempt = 0; !built && attempt < READ_BACK_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollingInterval));
        built = await request(requested.args._disputeID);
      }
      if (!built) throw new SwitchError("The request was mined but cannot be read back from the chain.");
      return projectTo(built, "submitted");
    } catch (error) {
      return fail(error, !sent);
    }
  }

  async function requests(owner: Address): Promise<SwitchRequest[]> {
    const logs = await getContractEventsPaged(foreign, {
      address: lightbulb,
      abi: lightbulbAbi,
      eventName: "LightbulbRequested",
      args: { _owner: owner },
    }, { fromBlock: env.foreign.fromBlock });
    const ids = logs.map((l) => l.args._disputeID as bigint).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
    const out: SwitchRequest[] = [];
    for (const id of ids) {
      const r = await request(id);
      if (r) out.push(r);
    }
    return out;
  }

  function watchRequest(disputeId: bigint, onChange: (request: SwitchRequest) => void): Unsubscribe {
    let stopped = false;
    let previous: SwitchRequest | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await request(disputeId);
        if (stopped) return;
        if (next) {
          for (const step of stageSteps(previous, next)) {
            if (stopped) return;
            onChange(step);
          }
          previous = next;
          if (isFinal(next)) return;
        }
      } catch {
        // The chain may be restarting or the RPC busy; try again on the next tick.
      }
      if (!stopped) timer = setTimeout(tick, watchInterval);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  async function rule(disputeId: bigint, ruling: 1 | 2): Promise<Hex> {
    // The dev account is unlocked on anvil: eth_sendTransaction, no key in the app.
    const wallet = createWalletClient({ chain: chains.home, transport: http(env.home.rpcUrl), account: DEV_ACCOUNT });
    return runRule(
      {
        request,
        simulate: (args) =>
          home.simulateContract({
            address: ha.KlerosCoreRuler,
            abi: [...rulerAbi, ...allErrorsAbi],
            functionName: "executeRuling",
            args,
            account: DEV_ACCOUNT,
          }),
        write: (args) => wallet.writeContract({ address: ha.KlerosCoreRuler, abi: rulerAbi, functionName: "executeRuling", args }),
        waitForReceipt: (hash) => home.waitForTransactionReceipt({ hash }),
        fail,
      },
      disputeId,
      ruling,
    );
  }

  return {
    chains: () => ({ foreign: info("foreign"), home: info("home") }),
    oracles: async () => (await wiring().catch(fail)).map((w) => w.oracle),
    defaultSelection: () => defaultSelection().catch(fail),
    validateSelection,
    quote: (selection, token) => quote(selection, token).catch(fail),
    bulbIsOn: (owner) =>
      foreign.readContract({ address: lightbulb, abi: lightbulbAbi, functionName: "lightbulbIsOn", args: [owner] }).catch(fail),
    usdcAllowance: (owner) => usdcAllowance(owner).catch(fail),
    approveUsdc,
    requestSwitch,
    request,
    requests: (owner) => requests(owner).catch(fail),
    watchRequest,
    act,
    devnet: env.testWallet ? { rule } : undefined,
  };
}
