// devnet:smoke driver (run by scripts/devnet-smoke.sh against a devnet it started): the whole GatewayLightbulb flow
// through the app's own data module, with the test connector (anvil dev account) the app offers.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { connect } from "wagmi/actions";
import { beforeAll, describe, expect, it } from "vitest";
import { createSwitchData, createWagmiConfig, type RequestStage, type SwitchData, type SwitchRequest } from "../src/data";
import { foreignGatewayAbi, lightbulbAbi } from "../src/data/abi";
import { DEV_ACCOUNT, devnetChains } from "../src/data/chain";
import { parseDevnetEnv, type ParsedDevnetEnv } from "../src/data/env";
import { FAILURE_STAGES, STAGES } from "../src/data/lifecycle";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE_TIMEOUT_MS = 120_000;

let env: ParsedDevnetEnv;
let data: SwitchData;

/** Watches a request through the module's watchRequest until `until`, collecting every snapshot. */
function watchUntil(disputeId: bigint, until: RequestStage): Promise<SwitchRequest[]> {
  return new Promise((resolve, reject) => {
    const seen: SwitchRequest[] = [];
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`dispute #${disputeId} stuck at ${seen.at(-1)?.stage ?? "nothing"} waiting for ${until}`));
    }, STAGE_TIMEOUT_MS);
    const stop = data.watchRequest(disputeId, (r) => {
      seen.push(r);
      if (r.stage === "failed") {
        clearTimeout(timer);
        stop();
        reject(new Error(`dispute #${disputeId} failed: ${r.error}`));
      } else if (r.stage === until) {
        clearTimeout(timer);
        stop();
        resolve(seen);
      }
    });
  });
}

/** Stages appear in lifecycle order, each at least once, from `from` to `to`, along one path. */
function expectStagesInOrder(seen: SwitchRequest[], from: RequestStage, to: RequestStage, path = STAGES) {
  const order = seen.map((r) => path.indexOf(r.stage as (typeof path)[number]));
  expect(order.every((v, i) => i === 0 || v >= order[i - 1])).toBe(true);
  const expected = path.slice(path.indexOf(from as never), path.indexOf(to as never) + 1);
  expect([...new Set(seen.map((r) => r.stage))]).toEqual(expected);
}

/** Polls the request until `ok` holds. */
async function until(disputeId: bigint, ok: (r: SwitchRequest) => boolean, what: string): Promise<SwitchRequest> {
  const deadline = Date.now() + STAGE_TIMEOUT_MS;
  let last: SwitchRequest | null = null;
  while (Date.now() < deadline) {
    last = await data.request(disputeId);
    if (last && ok(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`dispute #${disputeId} at ${last?.stage ?? "nothing"} never reached: ${what}`);
}

const reported = (r: SwitchRequest, leg: "dispute" | "ruling") =>
  r.reports.filter((x) => x.leg === leg && x.status === "reported").length;

beforeAll(async () => {
  env = parseDevnetEnv(JSON.parse(readFileSync(process.env.DEVNET_JSON ?? join(root, "public", "devnet.json"), "utf8")));
  expect(env.testWallet).toBe(true);
  const config = createWagmiConfig(env);
  const testConnector = config.connectors.find((c) => c.id === "mock");
  expect(testConnector).toBeDefined();
  const connected = await connect(config, { connector: testConnector!, chainId: env.foreign.chainId });
  expect(connected.accounts[0]).toBe(DEV_ACCOUNT);
  data = createSwitchData(env, config);
});

describe("devnet smoke", () => {
  it("reads the seeded oracles, default selection and quotes from ForeignGateway", async () => {
    const oracles = await data.oracles();
    expect(oracles.map((o) => [o.id, o.name, o.enabled])).toEqual([
      [0, "Vea", true],
      [1, "CCIP", true],
      [2, "LayerZero", true],
      [3, "deBridge", true],
    ]);
    expect(await data.defaultSelection()).toEqual({ oracleIds: [0, 1, 2], threshold: 2 });

    const foreign = createPublicClient({ transport: http(env.foreign.rpcUrl) });
    const gateway = env.addresses.foreign.ForeignGateway;
    const extraData = await foreign.readContract({
      address: env.addresses.foreign.GatewayLightbulb,
      abi: lightbulbAbi,
      functionName: "arbitratorExtraData",
    });
    const native = await data.quote(null, "native");
    expect(native.total).toBe(
      await foreign.readContract({ address: gateway, abi: foreignGatewayAbi, functionName: "arbitrationCost", args: [extraData] }),
    );
    expect(native.jurorFees + native.bridging.reduce((s, b) => s + b.amount, 0n)).toBe(native.total);
    const custom = await data.quote({ oracleIds: [1, 3], threshold: 2 }, "usdc");
    expect(custom.symbol).toBe("USDC");
    expect(custom.total).toBe(
      await foreign.readContract({
        address: gateway,
        abi: foreignGatewayAbi,
        functionName: "arbitrationCost",
        args: [extraData, [1n, 3n], env.addresses.foreign.USDC],
      }),
    );
    expect(data.validateSelection({ oracleIds: [0, 1], threshold: 3 }, oracles)).toEqual({
      kind: "threshold-too-high",
      threshold: 3,
      selected: 2,
    });
    await expect(data.requestSwitch({ oracleIds: [0, 1], threshold: 3 }, "native")).rejects.toThrow(/threshold/);
  });

  it("default oracles, ETH: relayed oracle by oracle, ruled 1, the bulb is on", async () => {
    const quote = await data.quote(null, "native");
    const request = await data.requestSwitch(null, "native");
    expect(request.stage).toBe("submitted");
    expect(request.owner).toBe(DEV_ACCOUNT);
    expect(request.selection).toEqual({ oracleIds: [0, 1, 2], threshold: 2 });
    expect(request.paid).toEqual({ token: "native", amount: quote.total });
    expect(request.txs[0]).toMatchObject({ stage: "submitted", chain: "foreign", label: "requestSwitch" });

    const toCourt = await watchUntil(request.disputeId, "dispute-received");
    expectStagesInOrder(toCourt, "submitted", "dispute-received");
    // Oracle by oracle: a snapshot with some but not all of the threshold reported was observed.
    expect(toCourt.some((r) => r.stage === "dispute-relaying" && reported(r, "dispute") === 1)).toBe(true);
    const received = toCourt.at(-1)!;
    expect(received.homeDisputeId).not.toBeNull();
    expect(received.creation?.state).toBe("created");
    // Delivered by Yaru, then created on the court by the keeper: two transactions on the home chain.
    expect(received.txs.filter((t) => t.chain === "home").map((t) => t.label)).toEqual(
      expect.arrayContaining(["executeMessages", "createReceivedDispute"]),
    );

    await expect(data.devnet!.rule(request.disputeId, 1)).resolves.toMatch(/^0x[0-9a-f]{64}$/);
    const back = await watchUntil(request.disputeId, "switched");
    expectStagesInOrder(back, "submitted", "switched"); // a new watcher reports every stage from the start
    const done = back.at(-1)!;
    expect(done.ruling).toBe(1);
    expect(reported(done, "ruling")).toBeGreaterThanOrEqual(2);
    expect(new Set(done.txs.map((t) => t.stage))).toEqual(new Set(STAGES)); // each stage has its transaction(s)
    expect(done.txs.at(-1)).toMatchObject({ stage: "switched", chain: "foreign", label: "executeRuling" });
    expect(done.actions).toEqual([]);
    expect(await data.bulbIsOn(DEV_ACCOUNT)).toBe(true);
    await expect(data.devnet!.rule(request.disputeId, 2)).rejects.toThrow(/already has a ruling/);
  });

  it("custom oracles, USDC: approved then requested, ruled 2, the bulb is off", async () => {
    const selection = { oracleIds: [1, 3], threshold: 2 };
    const quote = await data.quote(selection, "usdc");
    const request = await data.requestSwitch(selection, "usdc");
    expect(request.stage).toBe("submitted");
    expect(request.selection).toEqual(selection);
    expect(request.paid).toEqual({ token: "usdc", amount: quote.total });
    expect(await data.usdcAllowance(DEV_ACCOUNT)).toBe(0n); // exactly the total was approved and pulled

    const toCourt = await watchUntil(request.disputeId, "dispute-received");
    expectStagesInOrder(toCourt, "submitted", "dispute-received");
    await data.devnet!.rule(request.disputeId, 2);
    const back = await watchUntil(request.disputeId, "switched");
    expect(back.at(-1)!.ruling).toBe(2);
    expect(await data.bulbIsOn(DEV_ACCOUNT)).toBe(false);

    const mine = await data.requests(DEV_ACCOUNT);
    expect(mine.map((r) => r.disputeId)).toEqual([request.disputeId, request.disputeId - 1n]);
    expect(mine.every((r) => r.stage === "switched")).toBe(true);
  });

  it("failures: an unfunded HomeGateway keeps a delivered dispute waiting with the reason, then the keeper creates it; an unfunded reporter reverts", async () => {
    const chains = devnetChains(env);
    const home = createPublicClient({ chain: chains.home, transport: http(env.home.rpcUrl), pollingInterval: 100 });
    const foreign = createPublicClient({ chain: chains.foreign, transport: http(env.foreign.rpcUrl), pollingInterval: 100 });
    const homeDev = createWalletClient({ chain: chains.home, transport: http(env.home.rpcUrl), account: DEV_ACCOUNT });
    const foreignDev = createWalletClient({ chain: chains.foreign, transport: http(env.foreign.rpcUrl), account: DEV_ACCOUNT });
    const homeGateway = env.addresses.home.HomeGateway;
    const reporterAbi = parseAbi(["function withdraw(uint256 _amount)"]);

    // The governor empties the HomeGateway: the delivery still goes through, the court cannot open the case.
    const funds = await drainHomeGateway(home, homeDev);
    const request = await data.requestSwitch({ oracleIds: [0], threshold: 1 }, "native");
    const waiting = await until(request.disputeId, (r) => r.creation?.state === "waiting" && r.creation.blocker !== null, "a creation blocker");
    expect(waiting.stage).toBe("dispute-delivered");
    expect(waiting.creation!.blocker).toMatch(/lacks local ETH to open the case.*\n.*HomeGateway on Arbitrum-like needs .* ETH and holds 0 ETH/s);
    expect(waiting.actions).not.toContain("create-dispute");
    expect(waiting.homeDisputeId).toBeNull();
    expect(waiting.reports.find((r) => r.leg === "dispute")?.status).toBe("reported");

    // Funded again, the keeper's retry creates it.
    await home.waitForTransactionReceipt({ hash: await homeDev.sendTransaction({ to: homeGateway, value: funds }) });
    const recovered = await watchUntil(request.disputeId, "dispute-received");
    expect(recovered.at(-1)!.homeDisputeId).not.toBeNull();

    // A dispute-leg reporter without funds: requestSwitch reverts with a plain-language reason before sending.
    const vea = env.addresses.foreign.VeaReporter;
    const balance = await foreign.getBalance({ address: vea });
    await foreign.waitForTransactionReceipt({
      hash: await foreignDev.writeContract({ address: vea, abi: reporterAbi, functionName: "withdraw", args: [balance] }),
    });
    await expect(data.requestSwitch({ oracleIds: [0, 1], threshold: 1 }, "native")).rejects.toThrow(
      /^Cancelled before sending\. This oracle's relay service lacks local ETH for delivery\. The local operator needs to fund it\.\n.*The Vea reporter cannot pay its bridge fee.*choose oracles without Vea/s,
    );
    await foreign.waitForTransactionReceipt({ hash: await foreignDev.sendTransaction({ to: vea, value: balance }) });
  });

  it("creation failure: not created within the window, the failure goes back, the request closes and the juror fees are refunded", async () => {
    const chains = devnetChains(env);
    const home = createPublicClient({ chain: chains.home, transport: http(env.home.rpcUrl), pollingInterval: 100 });
    const foreign = createPublicClient({ chain: chains.foreign, transport: http(env.foreign.rpcUrl), pollingInterval: 100 });
    const homeDev = createWalletClient({ chain: chains.home, transport: http(env.home.rpcUrl), account: DEV_ACCOUNT });
    const bulbBefore = await data.bulbIsOn(DEV_ACCOUNT);
    const funds = await drainHomeGateway(home, homeDev);
    try {
      const selection = { oracleIds: [0, 2], threshold: 2 };
      const quote = await data.quote(selection, "native");
      const request = await data.requestSwitch(selection, "native");
      const waiting = await until(request.disputeId, (r) => r.creation?.state === "waiting", "delivered");
      expect(waiting.actions).not.toContain("send-failure"); // the window is still open
      await expect(data.act(request.disputeId, "send-failure")).rejects.toThrow(/^Cancelled before sending\. This step is no longer due/);

      const due = await until(request.disputeId, (r) => r.actions.includes("send-failure"), "the end of the creation window");
      expect(Date.now()).toBeGreaterThanOrEqual(due.creation!.failableAt);
      await expect(data.act(request.disputeId, "send-failure")).resolves.toMatch(/^0x[0-9a-f]{64}$/);

      // The failure returns over the same two oracles, the keeper executes it: closed, bulb unchanged, refund due.
      const back = await watchUntil(request.disputeId, "closed");
      expectStagesInOrder(back, "submitted", "closed", FAILURE_STAGES);
      expect(back.some((r) => r.stage === "failure-relaying" && reported(r, "ruling") === 1)).toBe(true);
      const closed = back.at(-1)!;
      expect(closed.creation?.state).toBe("failed");
      expect(closed.homeDisputeId).toBeNull();
      expect(closed.ruling).toBe(0);
      expect(new Set(closed.txs.map((t) => t.stage))).toEqual(new Set(FAILURE_STAGES));
      expect(closed.txs.find((t) => t.label === "sendCreationFailure")).toMatchObject({ stage: "creation-failed", chain: "home" });
      const bridging = quote.bridging.reduce((sum, b) => sum + b.amount, 0n);
      expect(closed.refund).toEqual({ token: "native", amount: quote.total - bridging, claimed: null });
      expect(closed.actions).toEqual(["claim-refund"]);
      expect(await data.bulbIsOn(DEV_ACCOUNT)).toBe(bulbBefore);

      // Anyone can claim; the juror fees go to the requester.
      const before = await foreign.getBalance({ address: DEV_ACCOUNT });
      const claimTx = await data.act(request.disputeId, "claim-refund");
      const receipt = await foreign.getTransactionReceipt({ hash: claimTx });
      const after = await foreign.getBalance({ address: DEV_ACCOUNT });
      expect(after - before + receipt.gasUsed * receipt.effectiveGasPrice).toBe(quote.total - bridging);
      const refunded = await until(request.disputeId, (r) => r.refund?.claimed != null, "the refund claim");
      expect(refunded.refund!.claimed).toEqual({ tx: claimTx, beneficiary: DEV_ACCOUNT });
      expect(refunded.actions).toEqual([]);
      expect(refunded.txs.at(-1)).toMatchObject({ stage: "closed", label: "claimRefund", hash: claimTx });
      await expect(data.act(request.disputeId, "claim-refund")).rejects.toThrow(/no longer due/);
    } finally {
      await home.waitForTransactionReceipt({ hash: await homeDev.sendTransaction({ to: env.addresses.home.HomeGateway, value: funds }) });
    }
  });
});

/** The governor withdraws the HomeGateway's whole balance; returns it so the caller can fund it back. */
async function drainHomeGateway(
  home: ReturnType<typeof createPublicClient>,
  homeDev: ReturnType<typeof createWalletClient>,
): Promise<bigint> {
  const homeGateway = env.addresses.home.HomeGateway;
  const funds = await home.getBalance({ address: homeGateway });
  const hash = await homeDev.writeContract({
    address: homeGateway,
    abi: parseAbi(["function withdraw(address _to, uint256 _amount)"]),
    functionName: "withdraw",
    args: [DEV_ACCOUNT, funds],
    chain: homeDev.chain,
    account: DEV_ACCOUNT,
  });
  await home.waitForTransactionReceipt({ hash });
  return funds;
}
