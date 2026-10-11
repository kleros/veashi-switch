// The chain-backed SwitchData: viem public clients read both devnet chains, the wagmi config's connected wallet
// writes on the foreign chain, and `devnet.rule` uses the anvil dev account on the home chain.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  zeroAddress,
  type Chain,
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
import type { ParsedDevnetEnv } from "./env";
import { CANCELLED_BEFORE_SENDING, describeError, MINED_REVERT, SwitchError, toSwitchError, withLead, type ErrorContext } from "./errors";
import { buildRequest, projectTo, stageSteps, type LegFacts, type RequestFacts } from "./lifecycle";
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
  SwitchData,
  SwitchRequest,
  Unsubscribe,
} from "./types";

/** anvil's first well-known dev account (mnemonic "test test ... junk"): governor, ruler and test wallet. */
export const DEV_ACCOUNT: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

export const WATCH_INTERVAL_MS = 1000;
const POLL_MS = 250; // receipts on the local anvil chains (viem defaults to 4 s)

export function devnetChains(env: ParsedDevnetEnv): { foreign: Chain; home: Chain } {
  const make = (c: ParsedDevnetEnv["foreign"]) =>
    defineChain({
      id: c.chainId,
      name: c.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [c.rpcUrl] } },
      testnet: true,
    });
  return { foreign: make(env.foreign), home: make(env.home) };
}

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

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

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
  const foreign = createPublicClient({ chain: chains.foreign, transport: http(env.foreign.rpcUrl), pollingInterval: POLL_MS }) as PublicClient;
  const home = createPublicClient({ chain: chains.home, transport: http(env.home.rpcUrl), pollingInterval: POLL_MS }) as PublicClient;
  const fa = env.addresses.foreign;
  const ha = env.addresses.home;
  const lightbulb = fa.GatewayLightbulb;
  const gateway = fa.ForeignGateway;
  const usdc = fa.USDC;

  const info = (key: "foreign" | "home"): ChainInfo => ({
    key,
    id: env[key].chainId,
    name: env[key].name,
    rpcUrl: env[key].rpcUrl,
    explorerTxUrl: null,
  });

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
    client: PublicClient,
    messageId: bigint,
    adapters: { oracleId: number; adapter: Address }[],
  ): Promise<LegFacts["reports"]> {
    const logs = await client.getContractEvents({
      address: adapters.map((a) => a.adapter),
      abi: adapterAbi,
      eventName: "HashStored",
      args: { id: messageId },
      fromBlock: 0n,
    });
    return adapters.map(({ oracleId, adapter }) => ({
      oracleId,
      txHash: logs.find((l) => sameAddress(l.address, adapter))?.transactionHash ?? null,
    }));
  }

  async function legFacts(
    source: PublicClient,
    target: PublicClient,
    dispatchTx: Hex,
    messageId: bigint,
    yaru: Address,
    adapters: { oracleId: number; adapter: Address }[],
    threshold: number,
  ): Promise<LegFacts> {
    const receipt = await source.getTransactionReceipt({ hash: dispatchTx });
    const dispatched = parseEventLogs({ abi: yahoAbi, logs: receipt.logs, eventName: "MessageDispatched" }).find(
      (l) => l.args.messageId === messageId,
    );
    const reports = await reportsOf(target, messageId, adapters);
    const executed = await target.getContractEvents({
      address: yaru,
      abi: yaruAbi,
      eventName: "MessageExecuted",
      args: { messageId },
      fromBlock: 0n,
    });
    const executedTx = executed[0]?.transactionHash ?? null;
    let failure: string | null = null;
    const reported = reports.filter((r) => r.txHash).length;
    if (!executedTx && dispatched && reported >= threshold) {
      // Enough oracles reported but nothing executed yet: simulate the execution to see whether it would revert.
      try {
        await target.simulateContract({
          address: yaru,
          abi: [...yaruAbi, ...allErrorsAbi],
          functionName: "executeMessages",
          args: [[dispatched.args.message as Message]],
          account: DEV_ACCOUNT,
        });
      } catch (error) {
        const text = describeError(error, await errorContext());
        // A race with the relayer executing it right now is not a failure.
        if (text !== describeError({ data: { errorName: "MessageIdAlreadyExecuted", args: [] } })) failure = text;
      }
    }
    return { messageId, dispatchTx, reports, executedTx, failure };
  }

  async function factsFor(disputeId: bigint): Promise<RequestFacts | null> {
    const requested = await foreign.getContractEvents({
      address: lightbulb,
      abi: lightbulbAbi,
      eventName: "LightbulbRequested",
      args: { _disputeID: disputeId },
      fromBlock: 0n,
    });
    const log = requested[0];
    if (!log) return null;
    const oracles = await wiring();
    const receipt = await foreign.getTransactionReceipt({ hash: log.transactionHash });
    const block = await foreign.getBlock({ blockNumber: receipt.blockNumber });
    const relayed = parseEventLogs({ abi: foreignGatewayAbi, logs: receipt.logs, eventName: "DisputeRelayed" })[0];
    const owner = log.args._owner as Address;

    let selection: OracleSelection = { oracleIds: [], threshold: 0 };
    let paid: RequestFacts["paid"] = { token: "native", amount: 0n };
    let dispute: LegFacts | null = null;
    let received = false;
    let homeDisputeId: bigint | null = null;
    let ruling: RequestFacts["ruling"] = null;
    let rulingLeg: LegFacts | null = null;
    let switched: RequestFacts["switched"] = null;

    if (relayed) {
      const { _disputeHash: disputeHash, _messageId: messageId } = relayed.args;
      const chosen = await foreign.readContract({
        address: gateway,
        abi: foreignGatewayAbi,
        functionName: "getDisputeOracles",
        args: [disputeHash],
      });
      selection = { oracleIds: chosen.oracleIDs.map(Number), threshold: Number(chosen.threshold) };
      const data = await foreign.readContract({
        address: gateway,
        abi: foreignGatewayAbi,
        functionName: "disputeHashtoDisputeData",
        args: [disputeHash],
      });
      const feeToken = data[4];
      paid = { token: sameAddress(feeToken, usdc) ? "usdc" : "native", amount: data[5] };
      const wire = (id: number) => oracles.find((w) => w.oracle.id === id);

      dispute = await legFacts(
        foreign,
        home,
        log.transactionHash,
        messageId,
        ha.Yaru,
        selection.oracleIds.map((oracleId) => ({ oracleId, adapter: wire(oracleId)?.disputeAdapter ?? zeroAddress })),
        selection.threshold,
      );
      const receivedDispute = await home.readContract({
        address: ha.HomeGateway,
        abi: homeGatewayAbi,
        functionName: "getReceivedDispute",
        args: [disputeHash],
      });
      received = receivedDispute.received;
      if (received) {
        homeDisputeId = await home.readContract({
          address: ha.HomeGateway,
          abi: homeGatewayAbi,
          functionName: "disputeHashtoID",
          args: [disputeHash],
        });
        const dispatched = await home.getContractEvents({
          address: ha.HomeGateway,
          abi: homeGatewayAbi,
          eventName: "RulingDispatched",
          args: { _disputeHash: disputeHash },
          fromBlock: 0n,
        });
        const rulingLog = dispatched[0];
        if (rulingLog) {
          ruling = { value: rulingLog.args._ruling as bigint, tx: rulingLog.transactionHash };
          rulingLeg = await legFacts(
            home,
            foreign,
            rulingLog.transactionHash,
            rulingLog.args._messageId as bigint,
            fa.Yaru,
            selection.oracleIds.map((oracleId) => ({ oracleId, adapter: wire(oracleId)?.rulingAdapter ?? zeroAddress })),
            selection.threshold,
          );
          const switchedLogs = await foreign.getContractEvents({
            address: lightbulb,
            abi: lightbulbAbi,
            eventName: "LightbulbSwitched",
            args: { _disputeID: disputeId },
            fromBlock: 0n,
          });
          if (switchedLogs[0]) switched = { tx: switchedLogs[0].transactionHash };
        }
      }
    }

    return {
      disputeId,
      owner,
      selection,
      paid,
      requestTx: log.transactionHash,
      requestedAt: Number(block.timestamp) * 1000,
      dispute,
      homeDisputeId,
      received,
      ruling,
      rulingLeg,
      switched,
      updatedAt: Date.now(),
    };
  }

  async function request(disputeId: bigint): Promise<SwitchRequest | null> {
    try {
      const facts = await factsFor(disputeId);
      if (!facts) return null;
      const ctx = await errorContext();
      return buildRequest(facts, ctx.oracleName);
    } catch (error) {
      return fail(error);
    }
  }

  async function connectedAccount(): Promise<Address> {
    const account = getAccount(config);
    if (account.status !== "connected" || !account.address) throw new SwitchError(`${CANCELLED_BEFORE_SENDING} Connect a wallet first.`);
    if (account.chainId !== env.foreign.chainId) {
      await switchChain(config, { chainId: env.foreign.chainId });
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
      const built = await request(requested.args._disputeID);
      if (!built) throw new SwitchError("The request was mined but cannot be read back from the devnet.");
      return projectTo(built, "submitted");
    } catch (error) {
      return fail(error, !sent);
    }
  }

  async function requests(owner: Address): Promise<SwitchRequest[]> {
    const logs = await foreign.getContractEvents({
      address: lightbulb,
      abi: lightbulbAbi,
      eventName: "LightbulbRequested",
      args: { _owner: owner },
      fromBlock: 0n,
    });
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
          if (next.stage === "switched") return; // final
        }
      } catch {
        // The devnet may be restarting; try again on the next tick.
      }
      if (!stopped) timer = setTimeout(tick, WATCH_INTERVAL_MS);
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
    devnet: env.testWallet ? { rule } : undefined,
  };
}
