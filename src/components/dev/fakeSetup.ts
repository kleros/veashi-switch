// Development only (`vite --mode fake`): an in-memory SwitchData that walks the request lifecycle on timers, so the
// pages can be built and their states checked without the devnet. main.tsx imports it only when
// import.meta.env.DEV, so it never reaches a build; it is not the app's data source.
import { createConfig, http } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import type { Chain } from "viem";
import type {
  Address,
  CostQuote,
  DevnetEnv,
  Hex,
  Oracle,
  OracleSelection,
  PayToken,
  SelectionError,
  StageTx,
  SwitchData,
  SwitchRequest,
} from "../../data";
import type { AppSetup } from "../setup";

const DEV: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // anvil's published account 0
const QS = new URLSearchParams(location.search);
const STEP_MS = Number(QS.get("step") ?? 1500);
const QUOTE_MS = Number(QS.get("quote") ?? 80); // slow quotes make the "Updating cost…" window visible
const STALL = QS.get("stall") === "1"; // the dispute leg ends in a paused delivery after the first report
const BULB_DELAY = Number(QS.get("bulbDelay") ?? 0); // ms the bulb read takes
const BULB_FAIL = QS.get("bulbFail") === "1"; // the bulb read is rejected
// e2e switches: `window.__veashi = { outage: true }` makes request() reject, `{ quoteFail: true }` makes quote() reject
const sw = (): { outage?: boolean; quoteFail?: boolean } =>
  ((window as unknown as { __veashi?: { outage?: boolean; quoteFail?: boolean } }).__veashi ?? {});
const FAIL = QS.get("fail"); // "cancel" | "revert" | "unknown": requestSwitch fails before sending / after a mined revert

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

const eth = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
const ORACLES: Oracle[] = [
  { id: 0, name: "Vea", via: "VeaReporter · VeaAdapter", enabled: true, bridgingCostWei: eth(0.00042) },
  { id: 1, name: "CCIP", via: "CCIPReporter · CCIPAdapter", enabled: true, bridgingCostWei: eth(0.00118) },
  { id: 2, name: "LayerZero", via: "LayerZeroReporter · LayerZeroAdapter", enabled: true, bridgingCostWei: eth(0.00086) },
  { id: 3, name: "deBridge", via: "DeBridgeReporter · DeBridgeAdapter", enabled: true, bridgingCostWei: eth(0.00095) },
];
const DEFAULT: OracleSelection = { oracleIds: [0, 1, 2], threshold: 2 };
const JUROR_FEES = eth(0.0027);
const USDC_PER_ETH = 2450n;

const hash = (): Hex =>
  `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fakeSetup(): AppSetup {
  const env: DevnetEnv = {
    foreign: { chainId: foreign.id, rpcUrl: "http://127.0.0.1:1", name: foreign.name },
    home: { chainId: home.id, rpcUrl: "http://127.0.0.1:2", name: home.name },
    addresses: { foreign: {}, home: {} },
    testWallet: true,
  };
  const config = createConfig({
    chains: [foreign, home],
    connectors: [injected(), mock({ accounts: [DEV], features: { reconnect: true } })],
    transports: { [foreign.id]: http(env.foreign.rpcUrl), [home.id]: http(env.home.rpcUrl) },
  });
  const requests = new Map<bigint, SwitchRequest>();
  const watchers = new Map<bigint, Set<(r: SwitchRequest) => void>>();
  const bulbs = new Map<string, boolean>();
  let allowance = 0n;
  let nextId = 1n;
  let nextHome = 0n;

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

  // Two finished requests owned by the test wallet, one ruled On and one Off, so Track can be seen without a wait.
  for (const ruling of [1, 2] as const) {
    const id = nextId++;
    const hid = nextHome++;
    const reports = (["dispute", "ruling"] as const).flatMap((leg) =>
      DEFAULT.oracleIds.slice(0, DEFAULT.threshold).map((o) => ({ oracleId: o, leg, status: "reported" as const })),
    );
    requests.set(id, {
      disputeId: id,
      homeDisputeId: hid,
      owner: DEV,
      selection: DEFAULT,
      paid: { token: "native", amount: JUROR_FEES + DEFAULT.oracleIds.reduce((t, o) => t + ORACLES[o].bridgingCostWei, 0n) },
      stage: "switched",
      ruling,
      reports,
      txs: [
        tx("submitted", "foreign", "requestSwitch"),
        tx("dispute-received", "home", "executeMessages"),
        tx("ruled", "home", "executeRuling"),
        tx("switched", "foreign", "executeMessages"),
      ],
      error: null,
      updatedAt: Date.now(),
    });
    bulbs.set(DEV.toLowerCase(), ruling === 1);
  }

  const relay = async (id: bigint, leg: "dispute" | "ruling") => {
    const r = requests.get(id)!;
    const { oracleIds, threshold } = r.selection;
    update(id, (x) => ({
      ...x,
      stage: leg === "dispute" ? "dispute-relaying" : "ruling-relaying",
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
          error:
            "The court side of this local devnet lacks local ETH to open the case. The local operator needs to fund it.\nThe HomeGateway on Arbitrum-like needs 0.1 ETH and holds 0 ETH; the case is created as soon as it is funded.",
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
    const hid = nextHome++;
    update(id, (x) => ({
      ...x,
      stage: "dispute-received",
      homeDisputeId: hid,
      txs: [...x.txs, tx("dispute-received", "home", "executeMessages")],
    }));
  };

  const data: SwitchData = {
    chains: () => ({
      foreign: { key: "foreign", id: foreign.id, name: foreign.name, rpcUrl: env.foreign.rpcUrl, explorerTxUrl: null },
      home: { key: "home", id: home.id, name: home.name, rpcUrl: env.home.rpcUrl, explorerTxUrl: null },
    }),
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
        decimals: token === "usdc" ? 6 : 18,
        symbol: token === "usdc" ? "USDC" : "ETH",
      };
    },
    bulbIsOn: async (o) => {
      if (BULB_DELAY) await sleep(BULB_DELAY);
      if (BULB_FAIL) throw new Error("bulb read failed");
      return bulbs.get(o.toLowerCase()) ?? false;
    },
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
        homeDisputeId: null,
        owner: who,
        selection: sel ?? DEFAULT,
        paid: { token, amount: q.total },
        stage: "submitted",
        ruling: 0,
        reports: [],
        txs: [tx("submitted", "foreign", token === "usdc" ? "requestSwitchWithToken" : "requestSwitch")],
        error: null,
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
    requests: async (o) =>
      [...requests.values()].filter((r) => r.owner.toLowerCase() === o.toLowerCase()).reverse(),
    watchRequest(id, cb) {
      if (!watchers.has(id)) watchers.set(id, new Set());
      watchers.get(id)!.add(cb);
      return () => watchers.get(id)?.delete(cb);
    },
    devnet: {
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
            txs: [...x.txs, tx("switched", "foreign", "executeMessages")],
          }));
          bulbs.set(r.owner.toLowerCase(), ruling === 1);
        })();
        return t.hash;
      },
    },
  };
  return { env, config, data };
}
