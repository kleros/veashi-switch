// The devnet relayer, standing in for the bridges: every message a MockYaho dispatches is reported on the other
// chain oracle by oracle (each adapter stores the hash, VEASHI_RELAY_STEP_MS apart, so the UI shows "1 of 2"), and
// executed through the other chain's MockYaru once the threshold is met. A failing execution is retried until it
// passes. It is also the gateways' keeper for the steps anyone can run: it creates every delivered dispute on the
// court (HomeGateway.createReceivedDispute, retried while it reverts, for example while the HomeGateway lacks funds)
// and gives every returned ruling or creation failure to the arbitrable (ForeignGateway.executeRuling). It never
// sends a creation failure: once a dispute's creation window has passed, that step is left to the Track page.
// Started by scripts/devnet.sh; reads DEVNET_JSON.
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient } from "viem";
import { adapterAbi, allErrorsAbi, foreignGatewayAbi, homeGatewayAbi, yahoAbi, yaruAbi } from "../src/data/abi";
import { devnetChains } from "../src/data/chain";
import { parseDevnetEnv } from "../src/data/env";
import { describeError } from "../src/data/errors";
import { RELAYER_ACCOUNT } from "./lib/seed";

const STEP_MS = Number(process.env.VEASHI_RELAY_STEP_MS ?? 1500);
const POLL_MS = 250;
const RETRY_MS = 2000;

const jsonPath = process.env.DEVNET_JSON;
if (!jsonPath) throw new Error("DEVNET_JSON is not set");
const env = parseDevnetEnv(JSON.parse(readFileSync(jsonPath, "utf8")));
const chains = devnetChains(env);

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

interface Pending {
  id: bigint;
  hash: Hex;
  message: Message;
  next: number; // index of the next adapter to report
  nextAt: number; // ms
  executed: boolean;
  retryAt: number;
}

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

function lane(name: string, from: "foreign" | "home", to: "foreign" | "home") {
  const source = createPublicClient({ chain: chains[from], transport: http(env[from].rpcUrl), pollingInterval: 100 }) as PublicClient;
  const target = createPublicClient({ chain: chains[to], transport: http(env[to].rpcUrl), pollingInterval: 100 }) as PublicClient;
  const wallet = createWalletClient({ chain: chains[to], transport: http(env[to].rpcUrl), account: RELAYER_ACCOUNT });
  const yaho = env.addresses[from].Yaho;
  const yaru = env.addresses[to].Yaru;
  const sourceChainId = BigInt(env[from].chainId);
  let fromBlock = 0n;
  const pending: Pending[] = [];

  async function poll() {
    const latest = await source.getBlockNumber();
    if (latest >= fromBlock) {
      const logs = await source.getContractEvents({
        address: yaho,
        abi: yahoAbi,
        eventName: "MessageDispatched",
        fromBlock,
        toBlock: latest,
      });
      for (const l of logs) {
        const id = l.args.messageId as bigint;
        const message = l.args.message as Message;
        if (BigInt(env[to].chainId) !== message.targetChainId) continue;
        const hash = (await source.readContract({
          address: yaho,
          abi: [
            {
              type: "function",
              name: "getPendingMessageHash",
              stateMutability: "view",
              inputs: [{ type: "uint256" }],
              outputs: [{ type: "bytes32" }],
            },
          ],
          functionName: "getPendingMessageHash",
          args: [id],
        })) as Hex;
        log(`${name}: message ${id} dispatched, ${message.adapters.length} oracles, threshold ${message.threshold}`);
        pending.push({ id, hash, message, next: 0, nextAt: Date.now() + STEP_MS, executed: false, retryAt: 0 });
      }
      fromBlock = latest + 1n;
    }

    const now = Date.now();
    for (const p of pending) {
      if (p.next < p.message.adapters.length && now >= p.nextAt) {
        const adapter = p.message.adapters[p.next];
        const stored = await target.readContract({
          address: adapter,
          abi: adapterAbi,
          functionName: "getHash",
          args: [sourceChainId, p.id],
        });
        if (stored !== p.hash) {
          const tx = await wallet.writeContract({
            address: adapter,
            abi: adapterAbi,
            functionName: "storeHash",
            args: [sourceChainId, p.id, p.hash],
          });
          await target.waitForTransactionReceipt({ hash: tx });
          log(`${name}: message ${p.id} reported by oracle ${p.next + 1}/${p.message.adapters.length}`);
        }
        p.next += 1;
        p.nextAt = Date.now() + STEP_MS;
      }
      if (!p.executed && p.next >= Number(p.message.threshold) && Date.now() >= p.retryAt) {
        const already = await target.readContract({ address: yaru, abi: yaruAbi, functionName: "executed", args: [p.id] });
        if (already) {
          p.executed = true;
          continue;
        }
        try {
          await target.simulateContract({
            address: yaru,
            abi: [...yaruAbi, ...allErrorsAbi],
            functionName: "executeMessages",
            args: [[p.message]],
            account: RELAYER_ACCOUNT,
          });
          const tx = await wallet.writeContract({
            address: yaru,
            abi: yaruAbi,
            functionName: "executeMessages",
            args: [[p.message]],
          });
          const receipt = await target.waitForTransactionReceipt({ hash: tx });
          p.executed = receipt.status === "success";
          log(`${name}: message ${p.id} executed (${receipt.status})`);
        } catch (error) {
          log(`${name}: message ${p.id} cannot execute yet: ${describeError(error)}`);
          p.retryAt = Date.now() + RETRY_MS;
        }
      }
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].executed && pending[i].next >= pending[i].message.adapters.length) pending.splice(i, 1);
    }
  }

  return { poll };
}

/**
 * The keeper: creates delivered disputes on the court and executes returned rulings and creation failures. Each
 * pending item is simulated first and retried every RETRY_MS while it would revert.
 */
function keeper() {
  const home = createPublicClient({ chain: chains.home, transport: http(env.home.rpcUrl), pollingInterval: 100 }) as PublicClient;
  const foreign = createPublicClient({ chain: chains.foreign, transport: http(env.foreign.rpcUrl), pollingInterval: 100 }) as PublicClient;
  const homeWallet = createWalletClient({ chain: chains.home, transport: http(env.home.rpcUrl), account: RELAYER_ACCOUNT });
  const foreignWallet = createWalletClient({ chain: chains.foreign, transport: http(env.foreign.rpcUrl), account: RELAYER_ACCOUNT });
  const homeGateway = env.addresses.home.HomeGateway;
  const foreignGateway = env.addresses.foreign.ForeignGateway;
  let homeFrom = 0n;
  let foreignFrom = 0n;
  const toCreate = new Map<Hex, { message: unknown; retryAt: number; reason: string }>();
  const toExecute = new Map<bigint, { retryAt: number; reason: string }>();

  async function send(
    client: PublicClient,
    wallet: typeof homeWallet | typeof foreignWallet,
    call: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] },
  ): Promise<string> {
    await client.simulateContract({ ...call, abi: [...call.abi, ...allErrorsAbi], account: RELAYER_ACCOUNT } as never);
    const tx = await wallet.writeContract(call as never);
    const receipt = await client.waitForTransactionReceipt({ hash: tx });
    return receipt.status;
  }

  async function poll() {
    const homeLatest = await home.getBlockNumber();
    if (homeLatest >= homeFrom) {
      const logs = await home.getContractEvents({
        address: homeGateway,
        abi: homeGatewayAbi,
        eventName: "DisputeReceived",
        fromBlock: homeFrom,
        toBlock: homeLatest,
      });
      for (const l of logs) toCreate.set(l.args._disputeHash as Hex, { message: l.args._message, retryAt: 0, reason: "" });
      homeFrom = homeLatest + 1n;
    }
    const foreignLatest = await foreign.getBlockNumber();
    if (foreignLatest >= foreignFrom) {
      for (const eventName of ["RulingReceived", "CreationFailureReceived"] as const) {
        const logs = await foreign.getContractEvents({
          address: foreignGateway,
          abi: foreignGatewayAbi,
          eventName,
          fromBlock: foreignFrom,
          toBlock: foreignLatest,
        });
        for (const l of logs) toExecute.set(l.args._disputeID as bigint, { retryAt: 0, reason: "" });
      }
      foreignFrom = foreignLatest + 1n;
    }

    const now = Date.now();
    for (const [hash, item] of toCreate) {
      if (now < item.retryAt) continue;
      const received = await home.readContract({
        address: homeGateway,
        abi: homeGatewayAbi,
        functionName: "getReceivedDispute",
        args: [hash],
      });
      if (received.created || received.creationFailed) {
        toCreate.delete(hash);
        continue;
      }
      try {
        const status = await send(home, homeWallet, {
          address: homeGateway,
          abi: homeGatewayAbi,
          functionName: "createReceivedDispute",
          args: [item.message],
        });
        log(`keeper: dispute ${hash.slice(0, 10)} created on the court (${status})`);
        if (status === "success") toCreate.delete(hash);
      } catch (error) {
        const reason = describeError(error).split("\n")[0];
        if (reason !== item.reason) log(`keeper: dispute ${hash.slice(0, 10)} cannot be created yet: ${reason}`);
        item.reason = reason;
        item.retryAt = Date.now() + RETRY_MS;
      }
    }
    for (const [id, item] of toExecute) {
      if (now < item.retryAt) continue;
      const [, , executed] = await foreign.readContract({
        address: foreignGateway,
        abi: foreignGatewayAbi,
        functionName: "receivedRulings",
        args: [id],
      });
      if (executed) {
        toExecute.delete(id);
        continue;
      }
      try {
        const status = await send(foreign, foreignWallet, {
          address: foreignGateway,
          abi: foreignGatewayAbi,
          functionName: "executeRuling",
          args: [id],
        });
        log(`keeper: dispute #${id} executed on the foreign chain (${status})`);
        if (status === "success") toExecute.delete(id);
      } catch (error) {
        const reason = describeError(error).split("\n")[0];
        if (reason !== item.reason) log(`keeper: dispute #${id} cannot be executed yet: ${reason}`);
        item.reason = reason;
        item.retryAt = Date.now() + RETRY_MS;
      }
    }
  }

  return { poll };
}

const lanes = [lane("dispute leg", "foreign", "home"), lane("return leg", "home", "foreign"), keeper()];
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
    log(`relayer: ${signal}, stopping`);
    process.exit(0);
  });
}

async function loop() {
  log(`relayer: started, step ${STEP_MS} ms`);
  if (process.env.RELAYER_READY_FILE) writeFileSync(process.env.RELAYER_READY_FILE, `${process.pid}\n`);
  while (!stopping) {
    for (const l of lanes) {
      try {
        await l.poll();
      } catch (error) {
        log(`relayer: poll failed: ${describeError(error)}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

void loop();
