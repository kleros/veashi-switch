// Seed configuration of the devnet deployment: the oracles, the default selection, the court and the USDC rate the
// pages show.
import { parseEther } from "viem";

export const FOREIGN_CHAIN_ID = 84_530_001; // Base-like; an id no public network uses (not 8453)
export const HOME_CHAIN_ID = 421_610_001; // Arbitrum-like; an id no public network uses (not 42161)
export const FOREIGN_NAME = "Base-like";
export const HOME_NAME = "Arbitrum-like";

/** anvil's well-known dev accounts (default mnemonic), unlocked by anvil: no key is used anywhere. */
export const DEV_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const; // governor, ruler, test wallet
export const RELAYER_ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const; // stands in for the bridges

export const ORACLES = [
  { id: 0, name: "Vea", roundTrip: parseEther("0.00042") },
  { id: 1, name: "CCIP", roundTrip: parseEther("0.00118") },
  { id: 2, name: "LayerZero", roundTrip: parseEther("0.00086") },
  { id: 3, name: "deBridge", roundTrip: parseEther("0.00095") },
] as const;

export const DEFAULT_SELECTION = { oracleIds: [0, 1, 2], threshold: 2 };
export const COURT = { id: 1n, name: "General Court", jurors: 3n, feeForJuror: parseEther("0.0009") };
export const HOME_NATIVE_RATE = 10n ** 18n; // Base and Arbitrum both use ETH.

// 1 ETH = 2450 USDC. ForeignGateway.convertEthToTokenAmount: tokens = wei * 10^rateDecimals / rateInEth, so with
// 6-decimal USDC rateInEth = 1e12 * 10^6 / 2450 (truncated).
export const USDC_PER_ETH = 2450n;
export const USDC_RATE_DECIMALS = 6;
export const USDC_RATE_IN_ETH = (10n ** 12n * 10n ** 6n) / USDC_PER_ETH;
export const USDC_MINT = 10_000n * 10n ** 6n;

export const HOME_GATEWAY_FUNDING = parseEther("10");
export const REPORTER_FUNDING = parseEther("1");
