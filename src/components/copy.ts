// Copy shared by the pages and the help dialog, kept as data so a unit test can hold it to the text rules.

/** Patterns no default view of Request or Track may show (case-insensitive); the technical details may. */
export const FORBIDDEN_TEXT: RegExp[] = [
  /Reporter/i,
  /Adapter/i,
  /keeper/i,
  /Kleros ops/i,
  /LightbulbSwitched/i,
  /requestSwitch/i,
  /onMessage/i,
  /createDispute/i,
  /Yaru/i,
  /HomeGateway/i,
  /ForeignGateway/i,
  /KlerosCoreRuler/i,
  /Gateway default/i,
  /Choose my own/i,
  /Waiting for jurors/i,
  /Stuck/i,
  /Nothing was charged/i,
  /Foreign dispute/i,
  /Home dispute/i,
  /On \(1\)/i,
  /Off \(2\)/i,
  /Higher is safer/i,
  /Reading /i,
];

export const AGREEMENT_HINT =
  "Delivery continues once this many selected oracles report the same message.";

/** The network the copy describes: the local two-chain devnet or the public testnets. */
export type CopyNetwork = "devnet" | "testnet";

export const requestIntro = (network: CopyNetwork) =>
  network === "testnet"
    ? "Send a request across two public test networks, then follow it on Track while the court decides."
    : "Send a request through two local chains, then simulate the court's decision on Track.";

/** Kept for the devnet build and its tests. */
export const REQUEST_INTRO = requestIntro("devnet");

export function helpStages(network: CopyNetwork): { lead: string; rest: string }[] {
  const testnet = network === "testnet";
  return [
    {
      lead: "Send the request.",
      rest: `USDC may first require an approval transaction. Then ${testnet ? "follow it" : "simulate the court decision"} on Track.`,
    },
    {
      lead: "Oracles carry it to the court.",
      rest: "Each oracle is an independent bridge. The request moves on once enough of them agree, for example 2 of 3.",
    },
    {
      lead: "The court opens the case.",
      rest: "Once the request arrives, anyone can open the case. The court side pays for it from its own funds.",
    },
    {
      lead: "The court decides.",
      rest: testnet
        ? "The decision is On or Off. On the test networks the court's ruler account gives it."
        : "The decision is On or Off. On this local demo you give the decision yourself from the Track page.",
    },
    {
      lead: "The decision comes back the same way.",
      rest: "The same oracles carry it back, and your bulb switches.",
    },
    {
      lead: "If the case cannot be opened in time,",
      rest: "anyone can send the failure back once the creation window closes. The same oracles carry it back, the request closes with the bulb unchanged, and the juror fees are refunded to you. The oracle fees are not refunded: they paid for the round trip.",
    },
  ];
}

export function helpTerms(network: CopyNetwork): { term: string; text: string }[] {
  const testnet = network === "testnet";
  return [
    { term: "Oracle", text: "A bridge (Vea, CCIP, LayerZero, deBridge) that reports a message from one chain on the other." },
    { term: "Agreement needed", text: AGREEMENT_HINT },
    testnet
      ? {
          term: "Due steps",
          text: "Delivering a message, opening the case and returning the answer are open to anyone. Track shows a button for each step that is due; any wallet can run it.",
        }
      : { term: "Automatic relay service", text: "A local service that delivers messages once enough oracles agree. You never wait on it to pay." },
    { term: "Court case", text: "The case the request opens on the court's chain. Its ID is shown beside the request ID." },
    {
      term: "Creation window",
      text: "How long the court side has to open the case after the request arrives. Once it closes, anyone can send the failure back.",
    },
    {
      term: "Refund",
      text: "When the case was not opened, the juror fees are refunded to the request's owner. Anyone can claim them for the owner.",
    },
    {
      term: "Request fee",
      text: `Juror fees plus each oracle's round trip. Network gas is extra and paid in ${testnet ? "testnet" : "local"} ETH.`,
    },
    {
      term: "tx 0x…",
      text: testnet
        ? "A finished step shows its transaction hash. Click it to open it in the block explorer."
        : "A finished step shows its transaction hash. Click it to copy it; the local network has no explorer.",
    },
  ];
}

export const helpNote = (network: CopyNetwork) =>
  network === "testnet"
    ? "Everything here runs on public test networks. Their tokens have no value, and every step is public."
    : "Everything here runs on a local demo network: two chains on this machine. Nothing is sent to a public network.";

export const HELP_STAGES = helpStages("devnet");
export const HELP_TERMS = helpTerms("devnet");
export const HELP_NOTE = helpNote("devnet");
