# Court template for the lightbulb case

[`court-template.json`](court-template.json) is the dispute template data for the lightbulb case in Kleros Court. It is one fixed template. Jurors check the requester's current lightbulb and rule the opposite:

- bulb off: **Switch it on** (answer 1)
- bulb on: **Switch it off** (answer 2)

The court does not read the bulb itself. Checking it is the jurors' job. Track helps them: `/case/<court case number>` opens the request, and while the court decides it shows the requester's bulb and the answer that flips it. The template also gives an on-chain route that needs no site.

[`court-primary-document.md`](court-primary-document.md) writes the same rule out as a standalone document: when the bulb is checked, how to check it and when to refuse.

The template is registered as it is in `court-template.json`. `GatewayLightbulb.templateId` is set only in its constructor, so the template comes with a new lightbulb: the site's `GatewayLightbulbV2` (see [A second lightbulb](../README.md#a-second-lightbulb-gatewaylightbulbv2)). The first testnet lightbulb `0x9b2F…Cff37` keeps template 197.

## How the court UI finds a HomeGateway case's template

The testnet court UI reads the template ID of a case from the Kleros core subgraph, which takes it from the events in the case's creation transaction (`subgraph/core/src/entities/Dispute.ts`, `updateDisputeRequestData`). The deployed subgraph runs kleros-v2 `master`'s logic:

1. If the transaction has a `CrossChainDisputeIncoming(address,uint256,address,uint256,uint256,uint256,uint256,string)` for the case (eight arguments), it decodes that one and stops. Its decoding of this event fails, so the case gets no template.
2. Otherwise it takes the template ID from `DisputeRequest(address,uint256,uint256,uint256,string)` (five arguments) for the case.

The HomeGateway of the pinned kleros-v2 commit (`d361a298`) emits both of these. Case 214 (request 2, template 197) therefore has no template in the subgraph, and the court UI shows an empty title bar for it.

The fix is a HomeGateway upgrade (in place, same proxy `0x9b2F…Cff37` on Arbitrum Sepolia). The upgraded HomeGateway emits, in `createReceivedDispute`:

- the same five-argument `DisputeRequest`, which `master`'s subgraph reads for the template ID;
- kleros-v2 `dev`'s six-argument `CrossChainDisputeIncoming(address,uint256,address,uint256,uint256,uint256)`, which a subgraph on `dev`'s logic reads first;
- no eight-argument `CrossChainDisputeIncoming`.

The ForeignGateway and the lightbulb contract do not change. Only cases opened after the upgrade get a template; case 214 keeps none.

The site reads `CrossChainDisputeIncoming` in both shapes (`src/data/abi.ts`, `creationTxOf` in `src/data/chain.ts`), only to link the transaction that opened a case. The case number comes from the HomeGateway's state, so it does not depend on the event.

## Data mappings: `"[]"`

Register the template with the mappings string `[]`, not an empty string. The court UI builds the template's data like this (`web/src/hooks/queries/usePopulatedDisputeData.ts`):

```ts
const data = dataMappings ? await executeActions(JSON.parse(dataMappings), initialContext) : {};
```

- `"[]"` is a non-empty string. It runs no action and makes no RPC call. `executeActions` then returns the case's initial context, and the template's variables are filled from it.
- An empty string skips that step, and every variable renders empty.
- Do not add mappings that read a chain. When an RPC call fails, the court UI shows "RPC failed!, Please avoid voting."

The `frontendUrl` is the template's deep link to the site. The court UI accepts https links and shows it as "Go to arbitrable", with an external-link warning. `/case/` without a number is a form that asks for the court case number.

## Answers, and why 0x00 is listed last

| id | title | description |
| --- | --- | --- |
| 0x01 | Switch it on | The requester's bulb is off when you vote. |
| 0x02 | Switch it off | The requester's bulb is on when you vote. |
| 0x00 | (shown as "Refuse to Arbitrate / Invalid") | The on-chain check finds no lightbulb request behind this case. The bulb is left unchanged. |

GatewayLightbulb's `RULING_ON` is 1 and `RULING_OFF` is 2. A ruling of 0 leaves the bulb as it is.

How the court UI handles answer 0, from `@kleros/kleros-sdk` 2.4.0 (the same code as kleros-v2 `dev`):

- `populateTemplate` (`findAndUpdateRTA`) replaces a template answer whose id is 0 with the reserved `RefuseToArbitrateAnswer`. Its title becomes "Refuse to Arbitrate / Invalid", and only the template's description is kept.
- Without an id-0 answer, it puts the reserved answer first, with the generic description "Refuse to Arbitrate / Invalid".
- The overview numbers the answers by position. Case 213 (template 195, no 0x0 answer) shows "1. Refuse to Arbitrate / Invalid - Refuse to Arbitrate / Invalid", then "2. The agent company …".
- The voting page always shows the non-zero answers as buttons and the refusal as a separate secondary button (`OptionsContainer.tsx`). Every other place matches answers by id, not position.

So the template includes 0x00 and lists it last. The overview then reads "1. Switch it on", "2. Switch it off", "3. Refuse to Arbitrate / Invalid": the numbers match ruling codes 1 and 2. The refusal also gets a description that says when to refuse and that the bulb is left unchanged. The title written for 0x00 is replaced anyway. The text refers to answers by title, never by number.

Refusal depends on the chain alone: `disputeIDtoHash` returning zero for the case. Nothing the site shows is a reason to refuse. The site finds the cases of both lightbulbs in its config (`GatewayLightbulb` and `GatewayLightbulbV2`).

## Registering it

### Order

1. **HomeGateway.** Upgrade the testnet HomeGateway to the implementation with the events above (`upgradeToAndCall(newImplementation, 0x)` from its governor).
2. **Template.** On Arbitrum Sepolia, call `DisputeTemplateRegistry.setDisputeTemplate` on `0xe763d31Cb096B4bc7294012B78FC7F148324ebcb` (kleros-v2 `deployments/arbitrumSepolia`). Anyone can call it.
   - `templateTag`: any tag.
   - `templateData`: `court-template.json` as a string.
   - `templateDataMappings`: `[]`.

   It emits `DisputeTemplate` with the new template ID. Read the ID from that event: anyone can register a template first, so `templates()` read beforehand is only a guess.
3. **Lightbulb.** Deploy a new GatewayLightbulb on Base Sepolia with the new template ID and the first lightbulb's other constructor arguments: the same ForeignGateway `0xD2065e…343a`, the same arbitrator extra data (court 8, 3 jurors) and `templateUri` "".
4. **Site.** Set `addresses.foreign.GatewayLightbulbV2` in `config/testnet.json` to the new lightbulb, leaving `GatewayLightbulb` and `foreign.fromBlock` as they are, and merge to `main` (Netlify deploys `main`).
5. **Check on a test request before any real one.** `/case/<n>` opens the request. The court UI shows the template's title, question and answers. Track shows the jurors' line while the court decides. `/track/1`, `/track/2` and `/case/214` still open the first lightbulb's requests.

### Checks before registering

- [ ] The HomeGateway upgrade is live: its `createReceivedDispute` emits the five-argument `DisputeRequest` and the six-argument `CrossChainDisputeIncoming`, and no eight-argument one.
- [ ] The text still matches the deployed contracts: `disputeIDtoHash`, `foreignGateway`, `disputeHashtoDisputeData` (request number first, lightbulb third), `requests` (owner first) and `lightbulbIsOn`. The text names no contract address, so a redeploy does not change it.
- [ ] The SDK checks below pass on the final JSON.

### Keep in step

The text quotes Track and the court UI. If any of these change, the template must change too, which means a new template:

- the route `/case/<number>` (`src/App.tsx`, `src/pages/CasePage.tsx`) and the label "Requester's bulb now" (`src/components/trackModel.ts`);
- the answer titles, which Track's jurors' line names (`jurorLine` in `src/components/trackModel.ts`);
- the court UI's "Case #".

## Checking it

These checks run outside the repository, with `@kleros/kleros-sdk` from npm:

- `DisputeDetailsSchema.safeParse` on the JSON;
- `populateTemplate(json, await executeActions([], { arbitratorDisputeID: "214", arbitrableAddress, arbitrableChainID: "421614", arbitrator }))`, a context as with mappings `[]`;
- `populateTemplate(json, {})`, as with no mappings.

Run each one on the pretty and on the minified JSON. All pass with 2.4.0, and the answers come out as above.
