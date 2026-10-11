// The ruling helper, standing in for the jurors: gives KlerosCoreRuler's ruling for a request's home dispute with
// the dev account. Usage, from veashi-switch/ with the devnet running:
//   node node_modules/vite-node/vite-node.mjs scripts/rule.ts <foreignDisputeId> <1|2>   (1 = on, 2 = off)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSwitchData, createWagmiConfig } from "../src/data";
import { parseDevnetEnv } from "../src/data/env";

const [disputeArg, rulingArg] = process.argv.slice(2);
if (!disputeArg || (rulingArg !== "1" && rulingArg !== "2")) {
  console.error("usage: rule.ts <foreignDisputeId> <1|2>   (1 = on, 2 = off)");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = parseDevnetEnv(JSON.parse(readFileSync(process.env.DEVNET_JSON ?? join(root, "public", "devnet.json"), "utf8")));
const data = createSwitchData(env, createWagmiConfig(env));
data
  .devnet!.rule(BigInt(disputeArg), rulingArg === "1" ? 1 : 2)
  .then((hash) => {
    console.log(`ruled ${rulingArg} for dispute #${disputeArg}: ${hash}`);
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
