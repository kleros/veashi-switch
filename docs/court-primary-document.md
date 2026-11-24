# Veashi lightbulb case: primary document

This is the primary document of each Kleros Court case opened for a Veashi lightbulb request: the cases of the dispute template "Veashi lightbulb: rule the opposite of the requester's current bulb state". It states the rule jurors rule by. The case's own text says the same.

## The case

A requester on Base Sepolia asked to switch their lightbulb (`GatewayLightbulb.requestSwitch`). The request crossed to Arbitrum Sepolia over Hashi oracles, and the Veashi HomeGateway opened this case on Kleros Court. The ruling goes back the same way, and `GatewayLightbulb.rule` applies it:

- ruling 1 switches the bulb on;
- ruling 2 switches it off;
- ruling 0 (refuse to arbitrate) leaves it as it is.

## The rule

Check the requester's lightbulb as it is when you vote, and rule the opposite of its state:

- the bulb is off: answer **Switch it on** (1);
- the bulb is on: answer **Switch it off** (2).

The court cannot see the bulb. Checking it is the jurors' task.

### When the bulb is checked

This case's question is about the bulb when you vote, because the ruling is applied to the bulb as it is then. Rule by the bulb's state at the moment you vote, and check it again just before you vote.

One owner can have more than one request open. If another of their requests is applied while this case is open, the bulb changes. Jurors who vote after that see the new state and rule its opposite. That is intended: the answer flips the bulb as it is when the vote is cast.

## How to check the bulb

You need this case's number. Kleros Court shows it as "Case #" at the top of the case page. No wallet is needed.

**On the site.** Open `https://veashi-switch.netlify.app/case/<case number>`. It opens the request's page, which shows "Requester's bulb now: On" or "Off", and, while the jurors vote, the answer that flips it. The site needs a browser that runs JavaScript.

**On-chain**, with read-only calls:

1. On Arbitrum Sepolia (chain 421614), on the HomeGateway that opened this case (the case's arbitrable contract), call `disputeIDtoHash(<case number>)` for the dispute hash, and `foreignGateway()` for the ForeignGateway.
2. On Base Sepolia (chain 84532), on that ForeignGateway, call `disputeHashtoDisputeData(<dispute hash>)`. The first value is the request number and the third is the lightbulb contract.
3. On the lightbulb contract, `requests(<request number>)` returns the owner first. `lightbulbIsOn(<owner>)` returns true when the bulb is on and false when it is off.

## When to refuse

Refuse to arbitrate only if the on-chain check shows no lightbulb request behind this case: `disputeIDtoHash(<case number>)` returns zero. The bulb is then left unchanged.

Do not refuse because the site shows an error, cannot read the bulb, or finds no request for the case number (the site may be set up for another lightbulb contract). Retry, or use the on-chain check.

## Answers

| Answer | When |
| --- | --- |
| 1 · Switch it on | The bulb is off when you vote. |
| 2 · Switch it off | The bulb is on when you vote. |
| 0 · Refuse to arbitrate | No lightbulb request is behind this case. The bulb is left unchanged. |
