// Development only (`vite --mode fake`): an in-memory SwitchData that walks the request lifecycle on timers, so the
// pages can be built and their states checked without the devnet. main.tsx imports it only when
// import.meta.env.DEV, so it never reaches a build; it is not the app's data source.
import { createConfig, http, type Config } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import type { Chain } from "viem";
import type {
  Address,
  CostQuote,
  DevnetEnv,
  Hex,
  NetworkEnv,
  Oracle,
  OracleSelection,
  PayToken,
  SelectionError,
  StageTx,
  SwitchData,
  SwitchRequest,
} from "../../data";
import { describeRevert } from "../../data/errors";
import type { AppSetup } from "../setup";

const DEV: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // anvil's published account 0
const QS = new URLSearchParams(location.search);
const STEP_MS = Number(QS.get("step") ?? 1500);
const QUOTE_MS = Number(QS.get("quote") ?? 80); // slow quotes make the "Updating cost…" window visible
const STALL = QS.get("stall") === "1"; // the dispute leg ends in a paused delivery after the first report
const CREATION_FAIL = QS.get("creation") === "fail"; // the court cannot open the case: the creation window runs out
const WINDOW_MS = Number(QS.get("window") ?? 4000); // the creation window, from the delivery
const BULB_DELAY = Number(QS.get("bulbDelay") ?? 0); // ms the bulb read takes
const BULB_FAIL = QS.get("bulbFail") === "1"; // the bulb read is rejected
const JURORS = QS.get("jurors") === "1"; // no local decision (as on a testnet): a request stays in court, as jurors see it
// a finished request the court refused to arbitrate (ruling 0), as request #90 / court case #90 of the test wallet
const REFUSED = QS.get("refused") === "1";
const REFUSED_ID = 90n;
// e2e switches: `window.__veashi = { outage: true }` makes request() reject, `{ quoteFail: true }` makes quote() reject,
// `{ bulbFail: true }` makes the bulb read reject
type Switches = { outage?: boolean; quoteFail?: boolean; bulbFail?: boolean };
const sw = (): Switches => ((window as unknown as { __veashi?: Switches }).__veashi ?? {});
const FAIL = QS.get("fail"); // "cancel" | "revert" | "unknown": requestSwitch fails before sending / after a mined revert
// ?routes=2: a second route beside the first, from an Arc-like chain whose gas token is USDC (18 decimals) and which
// takes no USDC token, with its court on the same Arbitrum-like chain (case numbers are shared, as on one court)
const TWO_ROUTES = QS.get("routes") === "2";

const foreign: Chain = {
  id: 31_337_001,
  name: "Base-like",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:1"] } },
};
const home: Chain = {
  id: 31_337_002,
  name: "Arbitrum-like",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:2"] } },
};
const arcLike: Chain = {
  id: 31_337_003,
  name: "Arc-like",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:3"] } },
};

const eth = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
const ORACLES: Oracle[] = [
  { id: 0, name: "Vea", via: "VeaReporter · VeaAdapter", enabled: true, bridgingCostWei: eth(0.00042) },
  { id: 1, name: "CCIP", via: "CCIPReporter · CCIPAdapter", enabled: true, bridgingCostWei: eth(0.00118) },
  { id: 2, name: "LayerZero", via: "LayerZeroReporter · LayerZeroAdapter", enabled: true, bridgingCostWei: eth(0.00086) },
  { id: 3, name: "deBridge", via: "DeBridgeReporter · DeBridgeAdapter", enabled: true, bridgingCostWei: eth(0.00095) },
];
const DEFAULT: OracleSelection = { oracleIds: [0, 1, 2], threshold: 2 };
const JUROR_FEES = eth(0.0027);
// The fake lightbulb: its requests get the jurors' line in court (?jurors=1), as on the testnet's GatewayLightbulbV2.
const LIGHTBULB: Address = "0x00000000000000000000000000000000000000b1";
const USDC_PER_ETH = 2450n;

const hash = (): Hex =>
  `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The plain-language reasons the devnet data layer gives for the same reverts (src/data/errors.ts).
const PAUSE_TEXT = describeRevert({ errorName: "ThresholdBelowMinimum", args: [3n] })!;
const BLOCKER_TEXT = describeRevert({ errorName: "InsufficientFunds", args: [eth(0.1), 0n] }, { homeChainName: "Arbitrum-like" })!;

/**
 * One fake route: its foreign chain, whether it takes the USDC token, its oracles (bridging costs in the chain's gas
 * token), its juror fees in that token, and the rulings of the finished requests it starts with.
 */
interface FakeRouteSpec {
  id: string;
  foreign: Chain;
  usdc: boolean;
  seed: readonly (1 | 2)[];
  lightbulb: Address;
  oracles: Oracle[];
  defaultSelection: OracleSelection;
  jurorFees: bigint;
}

// The Arc-like route: one oracle (Axelar, 0.52 USDC a round trip), juror fees of 0.0027 ETH at 2450 USDC per ETH.
const ARC_ORACLES: Oracle[] = [
  { id: 0, name: "Axelar", via: "AxelarReporter · AxelarAdapter", enabled: true, bridgingCostWei: 520_000_000_000_000_000n },
];

const BASE_LIKE: FakeRouteSpec = {
  id: "default",
  foreign,
  usdc: true,
  seed: [1, 2],
  lightbulb: LIGHTBULB,
  oracles: ORACLES,
  defaultSelection: DEFAULT,
  jurorFees: JUROR_FEES,
};

export function fakeSetup(): AppSetup {
  const specs: FakeRouteSpec[] = TWO_ROUTES
    ? [
        { ...BASE_LIKE, id: "base" },
        {
          id: "arc",
          foreign: arcLike,
          usdc: false,
          seed: [1],
          lightbulb: "0x00000000000000000000000000000000000000c1",
          oracles: ARC_ORACLES,
          defaultSelection: { oracleIds: [0], threshold: 1 },
          jurorFees: JUROR_FEES * USDC_PER_ETH,
        },
      ]
    : [BASE_LIKE];
  const chains = [foreign, home, ...(TWO_ROUTES ? [arcLike] : [])] as [Chain, ...Chain[]];
  const config = createConfig({
    chains,
    connectors: [injected(), mock({ accounts: [DEV], features: { reconnect: true } })],
    transports: Object.fromEntries(chains.map((c) => [c.id, http(c.rpcUrls.default.http[0])])),
  });
  const shared = { nextHome: 0n }; // one court: case numbers are counted across routes
  const routes = specs.map((spec, i) => {
    const { env, data } = fakeRoute(spec, config, shared);
    return { id: spec.id, isDefault: i === 0, env, data, missing: [] };
  });
  const network: NetworkEnv = { kind: "devnet", routes: routes.map((r) => r.env), testWallet: true, scannerUrl: null };
  return { network, config, routes };
}

function fakeRoute(spec: FakeRouteSpec, config: Config, shared: { nextHome: bigint }): { env: DevnetEnv; data: SwitchData } {
  const foreign = spec.foreign;
  const native = foreign.nativeCurrency;
  // this route's lightbulb, oracles and fees (amounts in its gas token)
  const LIGHTBULB = spec.lightbulb;
  const ORACLES = spec.oracles;
  const DEFAULT = spec.defaultSelection;
  const JUROR_FEES = spec.jurorFees;
  const env: DevnetEnv = {
    kind: "devnet",
    id: spec.id,
    foreign: {
      chainId: foreign.id,
      rpcUrl: foreign.rpcUrls.default.http[0],
      name: foreign.name,
      explorerUrl: null,
      fromBlock: 0n,
      nativeCurrency: native,
    },
    home: { chainId: home.id, rpcUrl: "http://127.0.0.1:2", name: home.name, explorerUrl: null, fromBlock: 0n },
    addresses: { foreign: {}, home: {} },
    testWallet: true,
    scannerUrl: null,
  };
  const requests = new Map<bigint, SwitchRequest>();
  const watchers = new Map<bigint, Set<(r: SwitchRequest) => void>>();
  const bulbs = new Map<string, boolean>();
  let allowance = 0n;
  let nextId = 1n;

  const owner = (): Address => {
    const a = config.state.connections.get(config.state.current ?? "")?.accounts[0];
    if (!a) throw new Error("Connector not connected.");
    return a;
  };
  const update = (id: bigint, f: (r: SwitchRequest) => SwitchRequest) => {
    const r = requests.get(id);
    if (!r) return;
    const n = { ...f(r), updatedAt: Date.now() };
    requests.set(id, n);
    watchers.get(id)?.forEach((cb) => cb(n));
  };
  const tx = (stage: StageTx["stage"], chain: StageTx["chain"], label: string): StageTx => ({
    stage,
    chain,
    label,
    hash: hash(),
  });

  const finishedReports = (["dispute", "ruling"] as const).flatMap((leg) =>
    DEFAULT.oracleIds.slice(0, DEFAULT.threshold).map((o) => ({ oracleId: o, leg, status: "reported" as const })),
  );
  const finishedTxs = () => [
    tx("submitted", "foreign", "requestSwitch"),
    tx("dispute-delivered", "home", "executeMessages"),
    tx("dispute-received", "home", "createReceivedDispute"),
    tx("ruled", "home", "executeRuling"),
    tx("ruling-relaying", "foreign", "executeMessages"),
    tx("switched", "foreign", "executeRuling"),
  ];
  // ?refused=1: a request ruled 0, with IDs outside the ones handed out below (so they do not move); the bulb is untouched.
  if (spec.seed.length > 0 && REFUSED)
    requests.set(REFUSED_ID, {
      disputeId: REFUSED_ID,
      lightbulb: LIGHTBULB,
      jurorGuide: true,
      homeDisputeId: REFUSED_ID,
      owner: DEV,
      selection: DEFAULT,
      paid: { token: "native", amount: JUROR_FEES + DEFAULT.oracleIds.reduce((t, o) => t + ORACLES[o].bridgingCostWei, 0n) },
      stage: "switched",
      ruling: 0,
      reports: finishedReports,
      txs: finishedTxs(),
      error: null,
      creation: { state: "created", deliveredAt: Date.now() - 60_000, failableAt: Date.now() + 60_000, blocker: null },
      refund: null,
      actions: [],
      updatedAt: Date.now(),
    });

  // Two finished requests owned by the test wallet, one ruled On and one Off, so Track can be seen without a wait.
  for (const ruling of spec.seed) {
    const id = nextId++;
    const hid = shared.nextHome++;
    requests.set(id, {
      disputeId: id,
      lightbulb: LIGHTBULB,
      jurorGuide: true,
      homeDisputeId: hid,
      owner: DEV,
      selection: DEFAULT,
      paid: { token: "native", amount: JUROR_FEES + DEFAULT.oracleIds.reduce((t, o) => t + ORACLES[o].bridgingCostWei, 0n) },
      stage: "switched",
      ruling,
      reports: finishedReports,
      txs: finishedTxs(),
      error: null,
      creation: { state: "created", deliveredAt: Date.now() - 60_000, failableAt: Date.now() + 60_000, blocker: null },
      refund: null,
      actions: [],
      updatedAt: Date.now(),
    });
    bulbs.set(DEV.toLowerCase(), ruling === 1);
  }

  const relay = async (id: bigint, leg: "dispute" | "ruling", stage: StageTx["stage"] = leg === "dispute" ? "dispute-relaying" : "ruling-relaying") => {
    const r = requests.get(id)!;
    const { oracleIds, threshold } = r.selection;
    update(id, (x) => ({
      ...x,
      stage,
      reports: [...x.reports, ...oracleIds.map((o) => ({ oracleId: o, leg, status: "pending" as const }))],
    }));
    // fastest first: LayerZero, deBridge, CCIP, Vea
    const order = [...oracleIds].sort((a, b) => [3, 2, 1, 0].indexOf(b) - [3, 2, 1, 0].indexOf(a)).reverse();
    for (let i = 0; i < threshold; i++) {
      await sleep(STEP_MS);
      if (STALL && i === 1) {
        update(id, (x) => ({
          ...x,
          stage: "failed",
          error: PAUSE_TEXT,
        }));
        return false;
      }
      const o = order[i];
      update(id, (x) => ({
        ...x,
        reports: x.reports.map((p) => (p.leg === leg && p.oracleId === o ? { ...p, status: "reported" } : p)),
      }));
    }
    await sleep(STEP_MS / 2);
    return true;
  };

  const run = async (id: bigint) => {
    await sleep(STEP_MS / 2);
    if (!(await relay(id, "dispute"))) return;
    const deliveredAt = Date.now();
    update(id, (x) => ({
      ...x,
      stage: "dispute-delivered",
      creation: { state: "waiting", deliveredAt, failableAt: deliveredAt + WINDOW_MS, blocker: null },
      txs: [...x.txs, tx("dispute-delivered", "home", "executeMessages")],
    }));
    await sleep(STEP_MS / 2);
    if (CREATION_FAIL) {
      update(id, (x) => ({ ...x, creation: x.creation && { ...x.creation, blocker: BLOCKER_TEXT } }));
      await sleep(Math.max(0, deliveredAt + WINDOW_MS - Date.now()));
      update(id, (x) => (x.stage === "dispute-delivered" ? { ...x, actions: ["send-failure"] } : x));
      return;
    }
    const hid = shared.nextHome++;
    update(id, (x) => ({
      ...x,
      stage: "dispute-received",
      homeDisputeId: hid,
      creation: x.creation && { ...x.creation, state: "created" },
      txs: [...x.txs, tx("dispute-received", "home", "createReceivedDispute")],
    }));
  };

  /** The creation-failure path after the window: the failure goes back, the request closes, the refund is due. */
  const fail = async (id: bigint) => {
    const r = requests.get(id)!;
    update(id, (x) => ({
      ...x,
      stage: "creation-failed",
      actions: [],
      creation: x.creation && { ...x.creation, state: "failed", blocker: null },
      txs: [...x.txs, tx("creation-failed", "home", "sendCreationFailure")],
    }));
    await sleep(STEP_MS / 2);
    await relay(id, "ruling", "failure-relaying");
    const jurorFees = r.paid.token === "usdc" ? (JUROR_FEES * USDC_PER_ETH) / 10n ** 12n : JUROR_FEES;
    update(id, (x) => ({
      ...x,
      stage: "closed",
      refund: { token: x.paid.token, amount: jurorFees, claimed: null },
      actions: ["claim-refund"],
      txs: [...x.txs, tx("failure-relaying", "foreign", "executeMessages"), tx("closed", "foreign", "executeRuling")],
    }));
  };

  const data: SwitchData = {
    chains: () => ({
      foreign: { key: "foreign", network: "devnet", id: foreign.id, name: foreign.name, rpcUrl: env.foreign.rpcUrl, explorerTxUrl: null, scannerTxUrl: null, nativeCurrency: { symbol: native.symbol, decimals: native.decimals } },
      home: { key: "home", network: "devnet", id: home.id, name: home.name, rpcUrl: env.home.rpcUrl, explorerTxUrl: null, scannerTxUrl: null, nativeCurrency: { symbol: "ETH", decimals: 18 } },
    }),
    payTokens: () => (spec.usdc ? ["native", "usdc"] : ["native"]),
    oracles: async () => ORACLES,
    defaultSelection: async () => DEFAULT,
    validateSelection(sel, oracles): SelectionError | null {
      if (sel.oracleIds.length === 0) return { kind: "empty" };
      const off = sel.oracleIds.find((id) => !oracles.find((o) => o.id === id)?.enabled);
      if (off !== undefined) return { kind: "disabled-oracle", oracleId: off };
      if (sel.threshold > sel.oracleIds.length)
        return { kind: "threshold-too-high", threshold: sel.threshold, selected: sel.oracleIds.length };
      return null;
    },
    async quote(sel, token: PayToken): Promise<CostQuote> {
      await sleep(QUOTE_MS);
      if (sw().quoteFail) throw new Error("The local network does not answer.");
      if (token === "usdc" && !spec.usdc) throw new Error(`This network takes no USDC token: pay in ${foreign.name}'s own gas token (${native.symbol}).`);
      const ids = (sel ?? DEFAULT).oracleIds;
      const conv = (wei: bigint) => (token === "usdc" ? (wei * USDC_PER_ETH) / 10n ** 12n : wei);
      const bridging = ids.map((id) => ({ oracleId: id, amount: conv(ORACLES[id].bridgingCostWei) }));
      const jurorFees = conv(JUROR_FEES);
      return {
        selection: sel,
        token,
        jurorFees,
        bridging,
        total: bridging.reduce((s, b) => s + b.amount, jurorFees),
        decimals: token === "usdc" ? 6 : native.decimals,
        symbol: token === "usdc" ? "USDC" : native.symbol,
      };
    },
    bulbIsOn: async (o) => {
      if (BULB_DELAY) await sleep(BULB_DELAY);
      if (BULB_FAIL || sw().bulbFail) throw new Error("bulb read failed");
      return bulbs.get(o.toLowerCase()) ?? false;
    },
    balance: async () => (native.symbol === "USDC" ? eth(25) : eth(1.25)),
    usdcAllowance: async () => allowance,
    async approveUsdc(amount) {
      await sleep(700);
      allowance = amount;
      return hash();
    },
    async requestSwitch(sel, token) {
      const who = owner();
      await sleep(900);
      if (FAIL === "cancel") throw new Error("Cancelled before sending.\nSimulation reverted: InsufficientPayment");
      if (FAIL === "unknown") throw new Error("The wallet closed unexpectedly");
      if (FAIL === "revert") throw new Error("Transaction failed: network gas may have been used.\nReverted with InvalidThreshold");
      const q = await data.quote(sel, token);
      if (token === "usdc") {
        if (allowance < q.total) throw new Error("ERC20: insufficient allowance");
        allowance -= q.total;
      }
      const id = nextId++;
      const r: SwitchRequest = {
        disputeId: id,
        lightbulb: LIGHTBULB,
        jurorGuide: true,
        homeDisputeId: null,
        owner: who,
        selection: sel ?? DEFAULT,
        paid: { token, amount: q.total },
        stage: "submitted",
        ruling: 0,
        reports: [],
        txs: [tx("submitted", "foreign", token === "usdc" ? "requestSwitchWithToken" : "requestSwitch")],
        error: null,
        creation: null,
        refund: null,
        actions: [],
        updatedAt: Date.now(),
      };
      requests.set(id, r);
      void run(id);
      return r;
    },
    request: async (id) => {
      if (sw().outage) throw new Error("The local network does not answer.");
      return requests.get(id) ?? null;
    },
    caseRequest: async (caseId) => {
      if (sw().outage) throw new Error("The local network does not answer.");
      return [...requests.values()].find((r) => r.homeDisputeId === caseId)?.disputeId ?? null;
    },
    requests: async (o) =>
      [...requests.values()].filter((r) => r.owner.toLowerCase() === o.toLowerCase()).reverse(),
    watchRequest(id, cb) {
      if (!watchers.has(id)) watchers.set(id, new Set());
      watchers.get(id)!.add(cb);
      return () => watchers.get(id)?.delete(cb);
    },
    async act(id, action) {
      const r = requests.get(id);
      if (!r || !r.actions.includes(action)) throw new Error("Cancelled before sending. This step is no longer due: refresh the status.");
      await sleep(600);
      if (action === "send-failure") {
        void fail(id);
        return hash();
      }
      if (action === "claim-refund") {
        const t = tx("closed", "foreign", "claimRefund");
        update(id, (x) => ({
          ...x,
          actions: [],
          refund: x.refund && { ...x.refund, claimed: { tx: t.hash, beneficiary: x.owner } },
          txs: [...x.txs, t],
        }));
        return t.hash;
      }
      throw new Error(`The fake setup does not run ${action}: the relay service does it.`);
    },
    // ?jurors=1: no local decision, as on a testnet (the Track page then shows the jurors' view while in court)
    devnet: JURORS
      ? undefined
      : {
          async rule(id, ruling) {
            const r = requests.get(id);
            if (!r || r.stage !== "dispute-received") throw new Error("This dispute is not waiting for a ruling.");
            await sleep(600);
            const t = tx("ruled", "home", "executeRuling");
            update(id, (x) => ({ ...x, stage: "ruled", ruling, txs: [...x.txs, t] }));
            void (async () => {
              await sleep(STEP_MS / 2);
              update(id, (x) => ({ ...x, txs: [...x.txs, { ...t, stage: "ruling-relaying", label: "rule → dispatch" }] }));
              await relay(id, "ruling");
              update(id, (x) => ({
                ...x,
                stage: "switched",
                txs: [...x.txs, tx("ruling-relaying", "foreign", "executeMessages"), tx("switched", "foreign", "executeRuling")],
              }));
              bulbs.set(r.owner.toLowerCase(), ruling === 1);
            })();
            return t.hash;
          },
        },
  };
  return { env, data };
}
