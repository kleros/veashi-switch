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
import { STAGES } from "../src/data/lifecycle";

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

/** Stages appear in lifecycle order, each at least once, from `from` to `to`. */
function expectStagesInOrder(seen: SwitchRequest[], from: RequestStage, to: RequestStage) {
  const order = seen.map((r) => STAGES.indexOf(r.stage as (typeof STAGES)[number]));
  expect(order.every((v, i) => i === 0 || v >= order[i - 1])).toBe(true);
  const expected = STAGES.slice(STAGES.indexOf(from as never), STAGES.indexOf(to as never) + 1);
  expect([...new Set(seen.map((r) => r.stage))]).toEqual(expected);
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
    expect(received.txs.map((t) => t.label)).toContain("executeMessages");

    await expect(data.devnet!.rule(request.disputeId, 1)).resolves.toMatch(/^0x[0-9a-f]{64}$/);
    const back = await watchUntil(request.disputeId, "switched");
    expectStagesInOrder(back, "submitted", "switched"); // a new watcher reports every stage from the start
    const done = back.at(-1)!;
    expect(done.ruling).toBe(1);
    expect(reported(done, "ruling")).toBeGreaterThanOrEqual(2);
    expect(new Set(done.txs.map((t) => t.stage))).toEqual(new Set(STAGES)); // each stage has its transaction(s)
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

  it("failures: an unfunded HomeGateway fails the request with the reason, then recovers; an unfunded reporter reverts", async () => {
    const chains = devnetChains(env);
    const home = createPublicClient({ chain: chains.home, transport: http(env.home.rpcUrl), pollingInterval: 100 });
    const foreign = createPublicClient({ chain: chains.foreign, transport: http(env.foreign.rpcUrl), pollingInterval: 100 });
    const homeDev = createWalletClient({ chain: chains.home, transport: http(env.home.rpcUrl), account: DEV_ACCOUNT });
    const foreignDev = createWalletClient({ chain: chains.foreign, transport: http(env.foreign.rpcUrl), account: DEV_ACCOUNT });
    const homeGateway = env.addresses.home.HomeGateway;
    const gatewayAbi = parseAbi(["function withdraw(address _to, uint256 _amount)"]);
    const reporterAbi = parseAbi(["function withdraw(uint256 _amount)"]);

    // The governor empties the HomeGateway: the dispute leg cannot create the dispute on the court.
    const funds = await home.getBalance({ address: homeGateway });
    await home.waitForTransactionReceipt({
      hash: await homeDev.writeContract({ address: homeGateway, abi: gatewayAbi, functionName: "withdraw", args: [DEV_ACCOUNT, funds] }),
    });
    const request = await data.requestSwitch({ oracleIds: [0], threshold: 1 }, "native");
    const failed = await watchUntil(request.disputeId, "failed").catch((e: Error) => e.message);
    expect(String(failed)).toMatch(/The court side of this local devnet lacks local ETH to open the case\. The local operator needs to fund it\.\n.*HomeGateway on Arbitrum-like needs .* ETH and holds .* ETH/s);
    const current = await data.request(request.disputeId);
    expect(current?.stage).toBe("failed");
    expect(current?.reports.find((r) => r.leg === "dispute")?.status).toBe("reported");

    // Funded again, the relayer's retry delivers it.
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
});
