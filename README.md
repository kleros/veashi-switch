# Veashi switch

The Request and Track pages of the GatewayLightbulb "switch" over the Kleros Veashi gateways. An integrator asks Kleros Court to switch a `GatewayLightbulb` on or off and follows the dispute across the gateways: the foreign chain (Base-like), the oracles to the home chain (Arbitrum-like), Kleros Court (a `KlerosCoreRuler` in manual mode) and the ruling back.

The wallet connects for real and the app makes real contract calls, against one of two networks chosen at build time:

- **the local two-chain anvil devnet** (the default) that this repository's scripts start and deploy. It uses chain ids no public network uses, and this build refuses any RPC URL whose host is not `127.0.0.1` or `localhost`;
- **the public testnets** Base Sepolia and Arbitrum Sepolia (`VITE_VEASHI_NETWORK=testnet`, the Netlify build; see [Deploying to Netlify](#deploying-to-netlify-testnets)). This build accepts only those testnet chain ids, over https, and never a mainnet.

Stack: Vite, React 18, TypeScript, styled-components, `@kleros/ui-components-library`, wagmi/viem, react-query. Unit tests use vitest; the end-to-end suite uses Playwright.

## Requirements

- Node 20 or later.
- Yarn 4. The release is committed under `.yarn/releases`, so any `yarn` (Corepack or a global install) runs it.
- Foundry (`forge`, `anvil`) on `PATH` or in `~/.foundry/bin`, for the devnet.
- The kleros-v2 submodule, for the devnet: clone with `git clone --recurse-submodules`, or run `git submodule update --init --depth 1` in an existing clone. Without `--depth 1`, git fetches kleros-v2's whole history (about 170 MB instead of 11 MB). Do not add `--recursive`: the devnet needs none of kleros-v2's own submodules.
- Playwright's Chromium for the end-to-end suite: `yarn playwright install chromium`.

## Commands

```bash
yarn install

yarn devnet            # start both anvils, deploy, start the relayer, write public/devnet.json, then exit
yarn devnet status     # the recorded processes and whether they are alive
yarn devnet stop       # stop only the processes recorded in .devnet/

yarn dev               # the app on Vite's dev server, against the running devnet
yarn dev --mode fake   # in-memory data, no chain (a development aid)

yarn check-types
yarn test              # vitest unit tests (src/**/*.test.ts)
yarn build

yarn devnet:smoke      # start a devnet on free ports, drive two full requests through src/data, stop it
yarn test:e2e          # Playwright: starts its own devnet and server (scripts/serve-e2e.sh), stops them after
VEASHI_E2E_FAKE=1 yarn test:e2e   # the same specs against the fake mode

# Rule on a request while the devnet runs (1 = on, 2 = off), standing in for the jurors:
node node_modules/vite-node/vite-node.mjs scripts/rule.ts <foreignDisputeId> <1|2>
```

Devnet settings: `VEASHI_FOREIGN_PORT` and `VEASHI_HOME_PORT` set the ports (defaults 8645 and 8646; `auto` picks free ports), `VEASHI_RELAY_STEP_MS` sets the relayer's pace between oracle reports (default 1500), and `VEASHI_CREATION_TIMEOUT` sets the HomeGateway's creation window in seconds (default 60; the smoke test uses 8 and the e2e server 12). Both anvils mine a block every second as well as on each transaction (`--block-time 1 --mixed-mining`), so the home chain's clock, which the creation window is measured on, keeps moving while nothing is sent. Only anvil's published dev accounts are used.

## Request lifecycle

A request goes through seven steps, each shown on Track:

1. **Request sent**: `GatewayLightbulb.requestSwitch` on the foreign chain pays the juror fees and each oracle's round trip, and the ForeignGateway dispatches the dispute to the selected oracles.
2. **Delivering request**: the oracles report the message on the home chain until the selection's threshold agree.
3. **Delivered**: `Yaru.executeMessages` hands it to `HomeGateway.onMessage`, which only records it (`DisputeReceived`).
4. **Court case opened**: `HomeGateway.createReceivedDispute`, which anyone can call, opens the case on `KlerosCoreRuler`, paid from the HomeGateway's own balance. It may revert (for example `InsufficientFunds`); the dispute then stays received and the call can be retried.
5. **Decision**: the ruler rules (manual mode) and the HomeGateway dispatches the ruling back over the same oracles.
6. **Decision returning**: the oracles report it on the foreign chain; `Yaru.executeMessages` records it on the ForeignGateway.
7. **Bulb updated**: `ForeignGateway.executeRuling`, which anyone can call, applies it to the `GatewayLightbulb`.

**When the case cannot be opened.** Once `creationTimeout` has passed since the delivery (step 3) and the case is still not open, anyone can call `HomeGateway.sendCreationFailure`. The failure goes back over the same oracles; `ForeignGateway.executeRuling` then calls `GatewayLightbulb.onDisputeCreationFailed` (`LightbulbRequestFailed`), so the request closes with the bulb unchanged and the juror fees become refundable. `GatewayLightbulb.claimRefund`, which anyone can call, pays them to the requester; the oracle fees are spent. Track shows this path as *Case not opened → Failure returning → Request closed*, with the refund and its claim.

**Who runs each step.** On the devnet the relayer (`scripts/relayer.ts`) delivers both legs, opens every delivered case (retrying while the call reverts) and executes every ruling or failure that arrives; it never sends a creation failure. Track therefore offers only *Send the failure back* and *Claim refund*. On the testnets no relay service is assumed: Track shows a button for each step that is due (deliver, open the case, send the failure back, deliver back, apply the result, claim the refund), and any connected wallet can run it. The ruling itself is given outside the app, by the testnet `KlerosCoreRuler`'s ruler account.

## Layout

- `src/data/`: the data layer the pages build on (`types.ts` is the seam; reads, quotes, the request lifecycle, errors, the wagmi config).
- `src/pages/`, `src/components/`, `src/theme/`: the Request and Track pages, the circuit and bulb (custom SVG), the shell and the theme.
- `scripts/`: the devnet (`devnet.sh`), deployment (`deploy.ts`, seeded from `lib/seed.ts`), the relayer, the ruling helper, the smoke test and the server the e2e suite runs against (`serve-e2e.sh`).
- `contracts/`: the devnet-only forge project. `src/` holds the Yaho/Yaru/reporter/adapter mocks and a mock USDC; `lib/kleros-v2/` is the kleros-v2 submodule, from which the devnet compiles the gateways, `GatewayLightbulb`, `KlerosCoreRuler` and `UUPSProxy` (see below).
- `e2e/`: the Playwright suite.

## Kleros v2 contracts

`contracts/lib/kleros-v2` is a shallow git submodule of [kleros-v2](https://github.com/kleros/kleros-v2), pinned to commit `d361a298b85f7c3e574e5827c3343b90111f18ca` on the branch `feat/veashi-gateways-master` ([kleros-v2#2604](https://github.com/kleros/kleros-v2/pull/2604)), which holds the Veashi gateways (with the two-step dispute creation and the creation failure) and `GatewayLightbulb`. `contracts/src/Imports.sol` pulls `ForeignGateway`, `HomeGateway`, `GatewayLightbulb`, `KlerosCoreRuler` and `UUPSProxy` from it into the devnet build, and their imports of `@kleros/veashi-sdk` and `@openzeppelin/contracts` resolve to this repository's `node_modules`. The published `@kleros/kleros-v2-contracts` package does not contain these gateways yet; once a release does, it can replace the submodule.

To move to another kleros-v2 commit:

```bash
git -C contracts/lib/kleros-v2 fetch --depth 1 origin <commit>
git -C contracts/lib/kleros-v2 checkout --detach <commit>
git add contracts/lib/kleros-v2
yarn devnet:smoke && yarn test:e2e
```

A changed contract ABI also needs `src/data/abi.ts` updated. If `feat/veashi-gateways-master` is rebased or deleted, the pinned commit can disappear from GitHub: repoint the submodule to the commit that replaced it.

## Deploying to Netlify (testnets)

The same app builds as a static site that talks to public testnets: Base Sepolia (foreign chain) and Arbitrum Sepolia (home chain). The build is selected by `VITE_VEASHI_NETWORK=testnet`, which `netlify.toml` sets; without it the app loads `/devnet.json` as before. There is no fake mode and no test wallet in a testnet build: only the injected (browser) wallet.

Settings live in `config/testnet.json`, bundled at build time: for each chain the id (only Base Sepolia, Arbitrum Sepolia and Sepolia are accepted), RPC URL (https), block explorer URL, `fromBlock` (the deployment block, where event scans start), and the contract addresses. `Yaho` and `Yaru` are filled in from `@kleros/veashi-sdk`. `ForeignGateway`, `GatewayLightbulb`, `USDC`, `HomeGateway` and `KlerosCoreRuler` are empty until the contracts are deployed; while any of them is empty the site shows a "Not connected to contracts yet" page. To go live, set those addresses and the `fromBlock` values, commit, and let Netlify rebuild. The deployed gateways must be the ones of the pinned kleros-v2 commit (two-step creation): the app reads `getReceivedDispute`, `creationTimeout` and the creation-failure events, and older gateways do not have them. The oracles' reporters and adapters are read from the ForeignGateway, so they need no entry here.

Optional build variables: `VITE_VEASHI_FOREIGN_RPC` and `VITE_VEASHI_HOME_RPC` replace the RPC URLs (still https only), for example with a provider key's URL; note that anything in a `VITE_` variable ends up in the public bundle.

RPCs and `eth_getLogs`: Track reads events, and public RPCs cap the block range of one `eth_getLogs` call. Measured on 2026-11-11: Base Sepolia's own `https://sepolia.base.org` allows only 200 blocks (a week of Base Sepolia is about 300,000 blocks), publicnode 50,000, and drpc's free plan 10,000. Arbitrum Sepolia's own RPC answered 2,000,000 blocks in one call. The config therefore uses `https://base-sepolia-rpc.publicnode.com` for Base Sepolia. The reader splits a refused range in chunks of the limit the error names, caches the logs per query so a poll only reads the blocks since the last one, and starts a request's foreign-chain reads at the request's own block. With publicnode, a request 300,000 blocks after `fromBlock` takes about 9 calls per query on first load and 2 per poll.

What Netlify relies on:

- `package.json` has `"packageManager": "yarn@4.9.2"` and a `yarn.lock` is committed, so Netlify installs Yarn and runs `yarn install`; `.yarnrc.yml` sets `nodeLinker: node-modules` (required on Netlify) and `yarnPath` to the committed release.
- `netlify.toml` sets the build command (`yarn build`), publish directory (`dist`), Node 22, and a `/*` to `/index.html` rewrite (status 200) so that `/track/<id>` works on reload. `public/_headers` adds basic security headers, without a CSP that could block wallet extensions.
- The `contracts/lib/kleros-v2` submodule is only for the local devnet's contracts; the web build does not read it. Check a build without submodules with `git clone <repo> && cd <repo> && yarn install --immutable && VITE_VEASHI_NETWORK=testnet yarn build`.

Local check of a testnet build: `VITE_VEASHI_NETWORK=testnet yarn build && yarn preview`.

## Origin

This app was first developed inside the [kleros-v2](https://github.com/kleros/kleros-v2) monorepo, on a branch that was not published, and moved to its own repository on 2026-10-15 with its history. The Kleros v2 contracts its devnet deploys come from the kleros-v2 submodule.
