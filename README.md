# Veashi switch

The Request and Track pages of the GatewayLightbulb "switch" over the Kleros Veashi gateways. An integrator asks Kleros Court to switch a `GatewayLightbulb` on or off and follows the dispute across the gateways: the foreign chain (Base-like), the oracles to the home chain (Arbitrum-like), Kleros Court (a `KlerosCoreRuler` in manual mode) and the ruling back.

The wallet connects for real and the app makes real contract calls, but **only against a local two-chain anvil devnet** that this repository's scripts start and deploy. Nothing is deployed to or sent on a public chain or testnet: the devnet uses chain ids no public network uses, and the app refuses any RPC URL whose host is not `127.0.0.1` or `localhost`.

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

Devnet settings: `VEASHI_FOREIGN_PORT` and `VEASHI_HOME_PORT` set the ports (defaults 8645 and 8646; `auto` picks free ports), and `VEASHI_RELAY_STEP_MS` sets the relayer's pace between oracle reports (default 1500). Only anvil's published dev accounts are used.

## Layout

- `src/data/`: the data layer the pages build on (`types.ts` is the seam; reads, quotes, the request lifecycle, errors, the wagmi config).
- `src/pages/`, `src/components/`, `src/theme/`: the Request and Track pages, the circuit and bulb (custom SVG), the shell and the theme.
- `scripts/`: the devnet (`devnet.sh`), deployment (`deploy.ts`, seeded from `lib/seed.ts`), the relayer, the ruling helper, the smoke test and the server the e2e suite runs against (`serve-e2e.sh`).
- `contracts/`: the devnet-only forge project. `src/` holds the Yaho/Yaru/reporter/adapter mocks and a mock USDC; `lib/kleros-v2/` is the kleros-v2 submodule, from which the devnet compiles the gateways, `GatewayLightbulb`, `KlerosCoreRuler` and `UUPSProxy` (see below).
- `e2e/`: the Playwright suite.

## Kleros v2 contracts

`contracts/lib/kleros-v2` is a shallow git submodule of [kleros-v2](https://github.com/kleros/kleros-v2), pinned to commit `56bfb6b810e4a5e0b5c7b6f5a365298da5476eb7` on the branch `feat/integrate-veashi`, which holds the Veashi gateways and `GatewayLightbulb`. `contracts/src/Imports.sol` pulls `ForeignGateway`, `HomeGateway`, `GatewayLightbulb`, `KlerosCoreRuler` and `UUPSProxy` from it into the devnet build, and their imports of `@kleros/veashi-sdk` and `@openzeppelin/contracts` resolve to this repository's `node_modules`. The published `@kleros/kleros-v2-contracts` package does not contain these gateways yet; once a release does, it can replace the submodule.

To move to another kleros-v2 commit:

```bash
git -C contracts/lib/kleros-v2 fetch --depth 1 origin <commit>
git -C contracts/lib/kleros-v2 checkout --detach <commit>
git add contracts/lib/kleros-v2
yarn devnet:smoke && yarn test:e2e
```

A changed contract ABI also needs `src/data/abi.ts` updated. If `feat/integrate-veashi` is rebased or deleted, the pinned commit can disappear from GitHub: repoint the submodule to the commit that replaced it.

## Origin

This app was first developed inside the [kleros-v2](https://github.com/kleros/kleros-v2) monorepo, on a branch that was not published, and moved to its own repository on 2026-10-15 with its history. The Kleros v2 contracts its devnet deploys come from the kleros-v2 submodule.
