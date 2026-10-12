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

export const REQUEST_INTRO = "Send a request through two local chains, then simulate the court's decision on Track.";

export const HELP_STAGES: { lead: string; rest: string }[] = [
  {
    lead: "Send the request.",
    rest: "USDC may first require an approval transaction. Then simulate the court decision on Track.",
  },
  {
    lead: "Oracles carry it to the court.",
    rest: "Each oracle is an independent bridge. The request moves on once enough of them agree, for example 2 of 3.",
  },
  {
    lead: "The court decides.",
    rest: "The decision is On or Off. On this local demo you give the decision yourself from the Track page.",
  },
  {
    lead: "The decision comes back the same way.",
    rest: "The same oracles carry it back, and your bulb switches.",
  },
];

export const HELP_TERMS: { term: string; text: string }[] = [
  { term: "Oracle", text: "A bridge (Vea, CCIP, LayerZero, deBridge) that reports a message from one chain on the other." },
  { term: "Agreement needed", text: AGREEMENT_HINT },
  { term: "Automatic relay service", text: "A local service that delivers messages once enough oracles agree. You never wait on it to pay." },
  { term: "Court case", text: "The case the request opens on the court's chain. Its ID is shown beside the request ID." },
  { term: "Request fee", text: "Juror fees plus each oracle's round trip. Network gas is extra and paid in local ETH." },
  { term: "tx 0x…", text: "A finished step shows its transaction hash. Click it to copy it; the local network has no explorer." },
];

export const HELP_NOTE =
  "Everything here runs on a local demo network: two chains on this machine. Nothing is sent to a public network.";
