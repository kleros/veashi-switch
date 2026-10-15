// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Brings the vendored Kleros v2 contracts (lib/kleros-v2) into this project's build, unchanged. Never edit them here.
import {ForeignGateway} from "kleros-v2/gateway/ForeignGateway.sol";
import {HomeGateway} from "kleros-v2/gateway/HomeGateway.sol";
import {GatewayLightbulb} from "kleros-v2/gateway/mock/GatewayLightbulb.sol";
import {KlerosCoreRuler} from "kleros-v2/arbitration/devtools/KlerosCoreRuler.sol";
import {UUPSProxy} from "kleros-v2/proxy/UUPSProxy.sol";
