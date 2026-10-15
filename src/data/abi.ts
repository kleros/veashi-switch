// The slices of the contracts' ABIs the app and the devnet scripts use. Hand-written from
// contracts/src/gateway/{ForeignGateway,HomeGateway}.sol, mock/GatewayLightbulb.sol, KlerosCoreRuler.sol and the
// devnet mocks in contracts/src, so the app does not need forge artifacts at build time.
import { parseAbi } from "viem";

const MESSAGE =
  "(uint256 nonce, uint256 targetChainId, uint256 threshold, address sender, address receiver, bytes data, address[] reporters, address[] adapters)";

export const foreignGatewayAbi = parseAbi([
  "function oracleCount() view returns (uint256)",
  "function oracles(uint256) view returns (address outboundReporter, address outboundAdapter, address inboundAdapter, bool enabled)",
  "function oracleBridgingCost(uint256) view returns (uint256)",
  "function getDefaultOracles() view returns ((uint256[] oracleIDs, uint256 threshold))",
  "function getDisputeOracles(bytes32) view returns ((uint256[] oracleIDs, uint256 threshold))",
  "function feeForJuror(uint96) view returns (uint256)",
  "function homeNativeRate() view returns (uint256)",
  "function currencyRates(address) view returns (bool feePaymentAccepted, uint64 rateInEth, uint8 rateDecimals)",
  "function convertEthToTokenAmount(address, uint256) view returns (uint256)",
  "function arbitrationCost(bytes) view returns (uint256)",
  "function arbitrationCost(bytes, uint256[]) view returns (uint256)",
  "function arbitrationCost(bytes, address) view returns (uint256)",
  "function arbitrationCost(bytes, uint256[], address) view returns (uint256)",
  "function disputeHashtoDisputeData(bytes32) view returns (uint248 id, bool ruled, address arbitrable, bool relayed, address feeToken, uint256 paid)",
  "event DisputeRelayed(bytes32 indexed _disputeHash, uint256 indexed _messageId)",
  "error GovernorOnly()",
  "error GovernorOrKeeperOnly()",
  "error YaruOnly()",
  "error ArbitrationFeesNotEnough()",
  "error DisputeDoesNotExist()",
  "error CannotRuleTwice()",
  "error AlreadyRelayed()",
  "error WrongSourceChain()",
  "error UnexpectedAdapters()",
  "error HomeGatewayMessageSenderOnly()",
  "error InvalidThreshold()",
  "error OracleNotEnabled(uint256 _oracleID)",
  "error DuplicateOracle(uint256 _oracleID)",
  "error TokenNotAccepted()",
  "error TransferFailed()",
]);

export const homeGatewayAbi = parseAbi([
  "function getReceivedDispute(bytes32) view returns ((bool received, uint256 threshold, uint256[] oracleIDs))",
  "function disputeHashtoID(bytes32) view returns (uint256)",
  "event CrossChainDisputeIncoming(address _arbitrator, uint256 _arbitrableChainId, address indexed _arbitrable, uint256 indexed _arbitrableDisputeID, uint256 indexed _arbitratorDisputeID, uint256 _externalDisputeID, uint256 _templateId, string _templateUri)",
  "event RulingDispatched(uint256 indexed _disputeID, bytes32 indexed _disputeHash, uint256 _ruling, uint256 _messageId)",
  "error ArbitratorOnly()",
  "error ForeignGatewayMessageSenderOnly()",
  "error DisputeAlreadyReceived()",
  "error InsufficientFunds(uint256 _required, uint256 _available)",
]);

export const lightbulbAbi = parseAbi([
  "function gateway() view returns (address)",
  "function arbitratorExtraData() view returns (bytes)",
  "function lightbulbIsOn(address) view returns (bool)",
  "function requests(uint256) view returns (address owner, bool ruled, uint256 ruling)",
  "function requestSwitch() payable returns (uint256)",
  "function requestSwitch(uint256[] _oracleIDs, uint256 _threshold) payable returns (uint256)",
  "function requestSwitchWithToken(address _feeToken) returns (uint256)",
  "function requestSwitchWithToken(uint256[] _oracleIDs, uint256 _threshold, address _feeToken) returns (uint256)",
  "event LightbulbRequested(address indexed _owner, uint256 indexed _disputeID, uint256[] _oracleIDs, uint256 _threshold)",
  "event LightbulbSwitched(address indexed _owner, uint256 indexed _disputeID, bool _isOn)",
  "error GatewayOnly()",
  "error UnknownDispute()",
  "error AlreadyRuled()",
  "error InsufficientPayment()",
  "error RefundFailed()",
  "error AllowanceIncreaseFailed()",
]);

export const rulerAbi = parseAbi([
  "function executeRuling(uint256 _disputeID, uint256 _ruling, bool tied, bool overridden)",
  "function currentRuling(uint256 _disputeID) view returns (uint256 ruling, bool tied, bool overridden)",
  "function arbitrationCost(bytes) view returns (uint256)",
  "error RulerOnly()",
  "error RulingModeNotSet()",
  "error RulingAlreadyExecuted()",
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

export const yahoAbi = parseAbi([
  `event MessageDispatched(uint256 indexed messageId, ${MESSAGE} message)`,
  "error InvalidThreshold(uint256 threshold, uint256 maxThreshold)",
  "error UnequalArrayLengths(uint256 arrayOne, uint256 arrayTwo)",
]);

export const yaruAbi = parseAbi([
  `function executeMessages(${MESSAGE}[] messages) returns (bytes[])`,
  "function executed(uint256) view returns (bool)",
  `event MessageExecuted(uint256 indexed messageId, ${MESSAGE} message)`,
  "error ThresholdNotMet(uint256 reported, uint256 threshold)",
  "error MessageIdAlreadyExecuted(uint256 messageId)",
  "error InvalidToChainId(uint256 chainId, uint256 expectedChainId)",
]);

export const reporterAbi = parseAbi([
  "function name() view returns (string)",
  "error ReporterCannotPay(string oracle, uint256 required, uint256 available)",
  "error NotYaho(address sender, address expectedYaho)",
]);

export const adapterAbi = parseAbi([
  "function name() view returns (string)",
  "function getHash(uint256 domain, uint256 id) view returns (bytes32)",
  "function storeHash(uint256 domain, uint256 id, bytes32 hash)",
  "event HashStored(uint256 indexed id, bytes32 indexed hash)",
  "error RelayerOnly()",
]);

/** Every custom error any devnet call can revert with, to decode raw revert data. */
export const allErrorsAbi = [
  ...foreignGatewayAbi,
  ...homeGatewayAbi,
  ...lightbulbAbi,
  ...rulerAbi,
  ...erc20Abi,
  ...yahoAbi,
  ...yaruAbi,
  ...reporterAbi,
  ...adapterAbi,
].filter((item) => item.type === "error");
