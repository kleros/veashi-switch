// HomeGateway's CrossChainDisputeIncoming in both shapes: the eight-argument one the testnet HomeGateway emitted up to
// its upgrade (court case 214, a real log), and kleros-v2 `dev`'s six-argument one it emits after (a log from the
// upgraded implementation on a fork, and one built here from the signature). Track finds a case's creation transaction
// by either.
import { describe, expect, it } from "vitest";
import { decodeEventLog, encodeAbiParameters, encodeEventTopics, parseEventLogs, toEventSelector, type Log } from "viem";
import { crossChainDisputeIncomingAbi, CROSS_CHAIN_DISPUTE_INCOMING, homeGatewayAbi } from "./abi";
import { creationTxOf, CROSS_CHAIN_DISPUTE_INCOMING_TOPICS } from "./chain";
import fixtures from "./fixtures/cross-chain-dispute-incoming.json";
import type { Address, Hex } from "./types";

const KLEROS_CORE: Address = "0xE8442307d36e9bf6aB27F1A009F95CE8E11C3479";
const LIGHTBULB: Address = "0x9b2F1d258F7ded62874807c6DD15247b5C6Cff37"; // the first testnet lightbulb (template 197)
const LIGHTBULB_V2: Address = "0x00000000000000000000000000000000000000b3";
const CASE_214_TX: Hex = "0xd5fbf2cf5b3ed2e886fbcca4c9013a89a964d037e162515e5fa0d17585ebeb6d";
const FORK_TX: Hex = "0xa88ec17a336a16879ca31be63130951c33596671d88fec9f5298b9359d167012";

// The first topics, written out: keccak256 of each signature (cast keccak).
const TOPIC_V1 = "0x2ecee3c6efdf9fe2284aca27b27774f7fdd967ff823bb1b329090ff881d8c40c";
const TOPIC_V2 = "0x7bdd942870e6528d890ac6842fbf96871f26779b13c2cba3fe25bd2fdfecce02";

type RawLog = { address: string; topics: string[]; data: string; transactionHash: string; logIndex: string; blockNumber: string };
const asLog = (raw: RawLog) => ({
  ...raw,
  address: raw.address as Address,
  topics: raw.topics as [Hex, ...Hex[]],
  data: raw.data as Hex,
  transactionHash: raw.transactionHash as Hex,
  blockNumber: BigInt(raw.blockNumber),
  logIndex: Number(raw.logIndex),
});
const v1 = asLog(fixtures.v1);
const v2 = asLog(fixtures.v2);
const disputeRequest = asLog(fixtures.disputeRequest);

/** A six-argument log as the upgraded HomeGateway emits it, built from the signature. */
function builtV2(arbitrable: Address, requestId: bigint, caseId: bigint, templateId: bigint, tx: Hex) {
  const [event] = crossChainDisputeIncomingAbi.filter((e) => toEventSelector(e) === TOPIC_V2);
  const topics = encodeEventTopics({
    abi: [event],
    eventName: "CrossChainDisputeIncoming",
    args: { _arbitrable: arbitrable, _arbitrableDisputeID: requestId, _arbitratorDisputeID: caseId },
  }) as [Hex, ...Hex[]];
  const data = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
    [KLEROS_CORE, 84532n, templateId],
  );
  return { address: LIGHTBULB, topics, data, transactionHash: tx, blockNumber: 1n, logIndex: 0 };
}

describe("CrossChainDisputeIncoming, both shapes", () => {
  it("has the two first topics of the old and the new signature, and only there (never by name in homeGatewayAbi)", () => {
    expect(CROSS_CHAIN_DISPUTE_INCOMING_TOPICS).toEqual([TOPIC_V1, TOPIC_V2]);
    expect(CROSS_CHAIN_DISPUTE_INCOMING.v2).toContain("uint256 _templateId)");
    // two events of one name in an ABI looked up by name: viem takes the first, so the other would never be read
    expect(homeGatewayAbi.some((item) => item.type === "event" && (item.name as string) === "CrossChainDisputeIncoming")).toBe(false);
  });

  it("decodes the live eight-argument log of court case 214 (request 2, template 197)", () => {
    expect(v1.topics[0]).toBe(TOPIC_V1);
    const decoded = decodeEventLog({ abi: crossChainDisputeIncomingAbi, topics: v1.topics, data: v1.data });
    expect(decoded.eventName).toBe("CrossChainDisputeIncoming");
    expect(decoded.args).toEqual({
      _arbitrator: KLEROS_CORE,
      _arbitrableChainId: 84532n,
      _arbitrable: LIGHTBULB,
      _arbitrableDisputeID: 2n,
      _arbitratorDisputeID: 214n,
      _externalDisputeID: 2n,
      _templateId: 197n,
      _templateUri: "",
    });
  });

  it("decodes the six-argument log the upgraded HomeGateway emitted on a fork (case 215, template 198)", () => {
    expect(v2.topics[0]).toBe(TOPIC_V2);
    const decoded = decodeEventLog({ abi: crossChainDisputeIncomingAbi, topics: v2.topics, data: v2.data });
    expect(decoded.args).toEqual({
      _arbitrator: KLEROS_CORE,
      _arbitrableChainId: 84532n,
      _arbitrable: "0x00000000000000000000000000000000000b0b1B",
      _arbitrableDisputeID: 1000n,
      _arbitratorDisputeID: 215n,
      _templateId: 198n,
    });
    // a built log of the same shape decodes the same way
    const built = builtV2(LIGHTBULB_V2, 3n, 216n, 198n, FORK_TX);
    expect(built.topics[0]).toBe(TOPIC_V2);
    expect(decodeEventLog({ abi: crossChainDisputeIncomingAbi, topics: built.topics, data: built.data }).args).toMatchObject({
      _arbitrable: LIGHTBULB_V2,
      _arbitrableDisputeID: 3n,
      _arbitratorDisputeID: 216n,
      _templateId: 198n,
    });
  });

  it("parses a mixed scan of both shapes by first topic, as the HomeGateway query returns it", () => {
    const parsed = parseEventLogs({ abi: crossChainDisputeIncomingAbi, logs: [v1, v2, disputeRequest] as unknown as Log[] });
    expect(parsed).toHaveLength(2); // the DisputeRequest is not one of them
    expect(parsed.map((l) => (l.args as { _arbitratorDisputeID: bigint })._arbitratorDisputeID)).toEqual([214n, 215n]);
  });
});

describe("creationTxOf (the transaction that opened a request's court case)", () => {
  const logs = [v1, v2, disputeRequest, builtV2(LIGHTBULB_V2, 3n, 216n, 198n, "0x" + "33".repeat(32) as Hex)];

  it("finds case 214's transaction from the old shape: lightbulb, request 2, case 214", () => {
    expect(creationTxOf(logs, { lightbulb: LIGHTBULB, disputeId: 2n, homeDisputeId: 214n })).toBe(CASE_214_TX);
    // the configured address is checksummed, the log's topic is not
    expect(creationTxOf(logs, { lightbulb: LIGHTBULB.toLowerCase() as Address, disputeId: 2n, homeDisputeId: 214n })).toBe(CASE_214_TX);
  });

  it("finds a new case's transaction from the new shape", () => {
    expect(creationTxOf(logs, { lightbulb: "0x00000000000000000000000000000000000b0b1B", disputeId: 1000n, homeDisputeId: 215n })).toBe(FORK_TX);
    expect(creationTxOf(logs, { lightbulb: LIGHTBULB_V2, disputeId: 3n, homeDisputeId: 216n })).toBe(`0x${"33".repeat(32)}`);
  });

  it("is null unless the lightbulb, the request and the court case all match (never the first log of the scan)", () => {
    expect(creationTxOf(logs, { lightbulb: LIGHTBULB, disputeId: 3n, homeDisputeId: 214n })).toBeNull();
    expect(creationTxOf(logs, { lightbulb: LIGHTBULB, disputeId: 2n, homeDisputeId: 215n })).toBeNull();
    expect(creationTxOf(logs, { lightbulb: LIGHTBULB_V2, disputeId: 2n, homeDisputeId: 214n })).toBeNull();
    expect(creationTxOf([], { lightbulb: LIGHTBULB, disputeId: 2n, homeDisputeId: 214n })).toBeNull();
  });

  it("ignores a log of another event with the same indexed topics", () => {
    const other = { ...v1, topics: [disputeRequest.topics[0], ...v1.topics.slice(1)] as [Hex, ...Hex[]] };
    expect(creationTxOf([other], { lightbulb: LIGHTBULB, disputeId: 2n, homeDisputeId: 214n })).toBeNull();
  });
});
