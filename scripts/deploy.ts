// Deploys and configures the whole devnet on the two anvil chains, then writes the DevnetEnv JSON.
// Run by scripts/devnet.sh: VEASHI_FOREIGN_RPC, VEASHI_HOME_RPC (local only), DEVNET_JSON_OUT.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { isLocalRpcUrl } from "../src/data/env";
import {
  COURT,
  DEFAULT_SELECTION,
  DEV_ACCOUNT,
  FOREIGN_CHAIN_ID,
  FOREIGN_NAME,
  HOME_CHAIN_ID,
  HOME_GATEWAY_FUNDING,
  HOME_NAME,
  HOME_NATIVE_RATE,
  ORACLES,
  RELAYER_ACCOUNT,
  REPORTER_FUNDING,
  USDC_MINT,
  USDC_RATE_DECIMALS,
  USDC_RATE_IN_ETH,
} from "./lib/seed";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "contracts", "out");

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const foreignRpc = env("VEASHI_FOREIGN_RPC");
const homeRpc = env("VEASHI_HOME_RPC");
for (const url of [foreignRpc, homeRpc]) if (!isLocalRpcUrl(url)) throw new Error(`refusing a non-local RPC: ${url}`);

function artifact(name: string, file = name): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(join(out, `${file}.sol`, `${name}.json`), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

function side(rpc: string, id: number, name: string) {
  const chain = defineChain({
    id,
    name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const pub = createPublicClient({ chain, transport: http(rpc), pollingInterval: 50 });
  const wallet = createWalletClient({ chain, transport: http(rpc), account: DEV_ACCOUNT });

  async function wait(hash: Hex) {
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${name}: transaction ${hash} reverted`);
    return receipt;
  }

  return {
    pub,
    async deploy(contract: string, args: readonly unknown[] = [], file = contract): Promise<Address> {
      const { abi, bytecode } = artifact(contract, file);
      const hash = await wallet.deployContract({ abi, bytecode, args } as never);
      const receipt = await wait(hash);
      if (!receipt.contractAddress) throw new Error(`${name}: ${contract} has no address`);
      return receipt.contractAddress;
    },
    async proxy(contract: string, initArgs: readonly unknown[]): Promise<Address> {
      const impl = await this.deploy(contract);
      const data = encodeFunctionData({ abi: artifact(contract).abi, functionName: "initialize", args: initArgs } as never);
      return this.deploy("UUPSProxy", [impl, data]);
    },
    async call(contract: string, address: Address, functionName: string, args: readonly unknown[] = [], value = 0n) {
      const { abi } = artifact(contract);
      await wait(await wallet.writeContract({ address, abi, functionName, args, value } as never));
    },
    async send(to: Address, value: bigint) {
      await wait(await wallet.sendTransaction({ to, value }));
    },
  };
}

async function main() {
  const foreign = side(foreignRpc, FOREIGN_CHAIN_ID, FOREIGN_NAME);
  const home = side(homeRpc, HOME_CHAIN_ID, HOME_NAME);
  for (const [s, id] of [[foreign, FOREIGN_CHAIN_ID], [home, HOME_CHAIN_ID]] as const) {
    const actual = await s.pub.getChainId();
    if (actual !== id) throw new Error(`chain id ${actual} answered where ${id} was expected`);
  }

  // Home mocks: Yaho, ruling-leg reporters, dispute-leg adapters, and the court.
  const homeYaho = await home.deploy("MockYaho");
  const homeReporters: Address[] = [];
  const homeAdapters: Address[] = [];
  for (const o of ORACLES) {
    homeReporters.push(await home.deploy("MockReporter", [homeYaho, o.name, o.roundTrip / 2n]));
    homeAdapters.push(await home.deploy("MockAdapter", [o.name, RELAYER_ACCOUNT]));
  }
  const ruler = await home.proxy("KlerosCoreRuler", [
    DEV_ACCOUNT,
    "0x0000000000000000000000000000000000000000",
    [0n, 10_000n, COURT.feeForJuror, 256n],
  ]);

  // Foreign mocks: Yaho, Yaru (from the home Yaho), dispute-leg reporters, ruling-leg adapters, USDC.
  const foreignYaho = await foreign.deploy("MockYaho");
  const foreignYaru = await foreign.deploy("MockYaru", [BigInt(HOME_CHAIN_ID)]);
  await foreign.call("MockYaru", foreignYaru, "setSourceYaho", [homeYaho]);
  const foreignReporters: Address[] = [];
  const foreignAdapters: Address[] = [];
  for (const o of ORACLES) {
    foreignReporters.push(await foreign.deploy("MockReporter", [foreignYaho, o.name, o.roundTrip / 2n]));
    foreignAdapters.push(await foreign.deploy("MockAdapter", [o.name, RELAYER_ACCOUNT]));
  }
  const usdc = await foreign.deploy("MockUSDC");
  const homeYaru = await home.deploy("MockYaru", [BigInt(FOREIGN_CHAIN_ID)]);
  await home.call("MockYaru", homeYaru, "setSourceYaho", [foreignYaho]);

  // ForeignGateway (home gateway set once deployed), then HomeGateway with the same oracle IDs mirrored.
  const extraData = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [COURT.id, COURT.jurors]);
  const foreignGateway = await foreign.proxy("ForeignGateway", [
    DEV_ACCOUNT,
    DEV_ACCOUNT,
    BigInt(HOME_CHAIN_ID),
    DEV_ACCOUNT, // placeholder, changeHomeGateway below
    foreignYaho,
    foreignYaru,
    HOME_NATIVE_RATE,
    ORACLES.map((_, i) => ({
      outboundReporter: foreignReporters[i],
      outboundAdapter: homeAdapters[i],
      inboundAdapter: foreignAdapters[i],
      enabled: true,
    })),
    DEFAULT_SELECTION.oracleIds.map(BigInt),
    BigInt(DEFAULT_SELECTION.threshold),
  ]);
  const lightbulb = await foreign.deploy("GatewayLightbulb", [foreignGateway, extraData, 0n, ""]);
  const homeGateway = await home.proxy("HomeGateway", [
    DEV_ACCOUNT,
    ruler,
    BigInt(FOREIGN_CHAIN_ID),
    foreignGateway,
    homeYaho,
    homeYaru,
    ORACLES.map((_, i) => ({
      outboundReporter: homeReporters[i],
      outboundAdapter: foreignAdapters[i],
      inboundAdapter: homeAdapters[i],
    })),
  ]);

  await foreign.call("ForeignGateway", foreignGateway, "changeHomeGateway", [homeGateway]);
  await foreign.call("ForeignGateway", foreignGateway, "changeCourtJurorFee", [COURT.id, COURT.feeForJuror]);
  for (const o of ORACLES) {
    await foreign.call("ForeignGateway", foreignGateway, "setOracleBridgingCost", [BigInt(o.id), o.roundTrip]);
  }
  await foreign.call("ForeignGateway", foreignGateway, "changeAcceptedFeeTokens", [usdc, true]);
  await foreign.call("ForeignGateway", foreignGateway, "changeCurrencyRates", [usdc, USDC_RATE_IN_ETH, USDC_RATE_DECIMALS]);
  await home.call("KlerosCoreRuler", ruler, "changeRulingModeToManual", [homeGateway]);
  await home.send(homeGateway, HOME_GATEWAY_FUNDING);
  for (const r of homeReporters) await home.send(r, REPORTER_FUNDING);
  for (const r of foreignReporters) await foreign.send(r, REPORTER_FUNDING);
  await foreign.call("MockUSDC", usdc, "mint", [DEV_ACCOUNT, USDC_MINT]);

  const named = (kind: string, list: Address[]) =>
    Object.fromEntries(ORACLES.map((o, i) => [`${o.name}${kind}`, list[i]]));
  const devnet = {
    foreign: { chainId: FOREIGN_CHAIN_ID, rpcUrl: foreignRpc, name: FOREIGN_NAME },
    home: { chainId: HOME_CHAIN_ID, rpcUrl: homeRpc, name: HOME_NAME },
    addresses: {
      foreign: {
        ForeignGateway: foreignGateway,
        GatewayLightbulb: lightbulb,
        USDC: usdc,
        Yaho: foreignYaho,
        Yaru: foreignYaru,
        ...named("Reporter", foreignReporters),
        ...named("Adapter", foreignAdapters),
      },
      home: {
        HomeGateway: homeGateway,
        KlerosCoreRuler: ruler,
        Yaho: homeYaho,
        Yaru: homeYaru,
        ...named("Reporter", homeReporters),
        ...named("Adapter", homeAdapters),
      },
    },
    testWallet: true,
  };
  writeFileSync(env("DEVNET_JSON_OUT"), `${JSON.stringify(devnet, null, 2)}\n`);
  console.log(`deployed: ForeignGateway ${foreignGateway}, HomeGateway ${homeGateway}, GatewayLightbulb ${lightbulb}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
