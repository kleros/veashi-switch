# Vendored Kleros v2 contracts

`src/` is an unchanged copy of the files below from `contracts/src/` in [kleros-v2](https://github.com/kleros/kleros-v2), taken from the branch `feat/integrate-veashi` at commit `56bfb6b810e4a5e0b5c7b6f5a365298da5476eb7`. They are the import closure of the five contracts `../../src/Imports.sol` brings into the devnet build: `ForeignGateway`, `HomeGateway`, `GatewayLightbulb`, `KlerosCoreRuler` and `UUPSProxy`. Their own imports of `@kleros/veashi-sdk` and `@openzeppelin/contracts` resolve to this repository's `node_modules`.

```
arbitration/devtools/KlerosCoreRuler.sol
arbitration/interfaces/IArbitrableV2.sol
arbitration/interfaces/IArbitratorV2.sol
gateway/ForeignGateway.sol
gateway/HomeGateway.sol
gateway/interfaces/IForeignGateway.sol
gateway/interfaces/IHomeGateway.sol
gateway/mock/GatewayLightbulb.sol
libraries/Constants.sol
libraries/SafeERC20.sol
proxy/Initializable.sol
proxy/UUPSProxiable.sol
proxy/UUPSProxy.sol
```

Never edit them here. These are the gateways the UI was built and tested against. Later kleros-v2 branches change `ForeignGateway.sol` and `HomeGateway.sol`. To move to another version, copy the same paths from that kleros-v2 commit, update the commit above, and run `forge build`, `yarn devnet:smoke` and `yarn test:e2e`. A changed ABI also needs `src/data/abi.ts` updated.
