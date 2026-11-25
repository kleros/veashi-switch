import React, { useEffect, useRef } from "react";
import styled from "styled-components";
import { chainColor, routeConfig, type WalletGate } from "./route";
import { Disclosure, Panel, PanelHead } from "./ui";
import { NetworkDown } from "./NetworkDown";
import { useRoute, useSetup } from "./setup";
import { WalletStrip } from "./wallet";

const Cards = styled.div`
  display: flex;
  align-items: stretch;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
`;

const Card = styled.div<{ $c: string }>`
  flex: 1 1 260px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
  padding: 14px 16px;
  min-height: 56px;
  border: 1px solid var(--stroke-strong);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  .label {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .value {
    font-weight: 600;
  }
  .value::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 8px;
    border-radius: 50%;
    background: ${({ $c }) => $c};
    vertical-align: 1px;
  }
`;

/** The route picker: one card per network a request can be sent from, as a radio group. */
const Picker = styled.fieldset`
  border: 0;
  margin: 0 0 12px;
  padding: 0;
  min-width: 0;
  legend {
    padding: 0;
    margin-bottom: 8px;
    font-weight: 600;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  /* one card per route: the label (radio and network name) covers the whole card, the note sits under it */
  .option {
    position: relative;
    flex: 1 1 220px;
    display: grid;
    gap: 2px;
    min-height: 56px;
    padding: 10px 16px;
    border: 1px solid var(--stroke-strong);
    border-radius: var(--r-lg);
    background: var(--surface);
  }
  .option:has(input:checked) {
    border-color: var(--purple-2);
    background: var(--surface-2);
    box-shadow: 0 0 0 1px var(--purple-2);
  }
  .option:has(input:focus-visible) {
    outline: 2px solid var(--purple-2);
    outline-offset: 2px;
  }
  .option:has(input:disabled) {
    opacity: 0.6;
  }
  label {
    display: flex;
    align-items: center;
    gap: 12px;
    white-space: nowrap;
    cursor: pointer;
  }
  label::after {
    content: "";
    position: absolute;
    inset: 0;
  }
  input {
    position: relative; /* above the label's card-wide click area */
    z-index: 1;
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--purple-2);
    cursor: pointer;
  }
  .name {
    font-weight: 600;
  }
  .what {
    padding-left: 30px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
`;

const Arrow = styled.span`
  align-self: center;
  color: var(--text-2);
  font-size: var(--fs-lg);
  @media (max-width: 640px) {
    display: none;
  }
`;

/** The local-only boundary: a quiet label beside the heading, not a competing box. */
const Badge = styled.span`
  display: inline-grid;
  gap: 2px;
  justify-items: end;
  text-align: right;
  color: var(--warn);
  font-size: var(--fs-sm);
  font-weight: 600;
  small {
    font-weight: 400;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  @media (max-width: 640px) {
    justify-items: start;
    text-align: left;
  }
`;

const Wallet = styled.div`
  margin-top: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--stroke);
`;

const Details = styled.dl`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 14px;
  margin: 0;
  dt {
    font-weight: 600;
    color: var(--text);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  @media (max-width: 480px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

// The Request page starts afresh on a new pick (its oracles and fees are that route's), so the radio that was picked
// is focused again once the page is back, for a keyboard user to carry on from it.
let refocus: string | null = null;

/**
 * "1 · Network route": the route (local devnet or public testnets), its boundary and the wallet state. With several
 * routes, the network to send from is picked here first; the rest of the page follows the pick.
 */
export const RouteSection: React.FC<{
  gate: WalletGate;
  unavailable: string | null;
  onRetry: () => void;
  children?: React.ReactNode;
}> = ({ gate, unavailable, onRetry, children }) => {
  const route = useRoute();
  const { routes, selectedId, selectRoute } = useSetup();
  const several = routes.length > 1;
  const picker = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    const id = refocus;
    if (id === null) return;
    // after the page's own mount effects (one of them may focus a step heading)
    const frame = requestAnimationFrame(() => {
      refocus = null;
      picker.current?.querySelector<HTMLInputElement>(`input[value="${id}"]`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <Panel id="network-route" style={{ scrollMarginTop: "calc(var(--bar-h, 0px) + 8px)" }} aria-labelledby="route-h" data-testid="route-section">
      <PanelHead>
        <div>
          <h2 id="route-h" data-step-heading>
            Network route
          </h2>
          <p>
            {several
              ? `Pick the network your lightbulb is on. The court is on ${route.to.name}; its ruling returns to the network you pick.`
              : `The ruling returns to ${route.from.name}. Only this ${route.testnet ? "testnet" : "local"} route is available.`}
          </p>
        </div>
        {route.testnet ? (
          <Badge data-testid="local-badge">
            Public testnets only
            <small>No mainnet. Test tokens have no value</small>
          </Badge>
        ) : (
          <Badge data-testid="local-badge">
            Local devnet only
            <small>No public networks or testnets</small>
          </Badge>
        )}
      </PanelHead>
      {several && (
        <Picker data-testid="route-picker" ref={picker}>
          <legend>Send from</legend>
          <div className="options">
            {routes.map((r) => {
              const c = routeConfig(r.data.chains());
              const pay = r.data.payTokens().includes("usdc") ? `Pay in ${c.from.nativeCurrency.symbol} or USDC` : `Pay in ${c.from.nativeCurrency.symbol}`;
              return (
                <div key={r.id} className="option" data-testid={`route-option-${r.id}`}>
                  <label>
                    <input
                      type="radio"
                      name="route"
                      value={r.id}
                      checked={selectedId === r.id}
                      disabled={r.missing.length > 0}
                      aria-describedby={`route-what-${r.id}`}
                      onChange={() => {
                        refocus = r.id;
                        selectRoute(r.id);
                      }}
                    />
                    <span className="name">{c.from.name}</span>
                  </label>
                  <span className="what" id={`route-what-${r.id}`}>
                    {r.missing.length > 0 ? "Not set up yet" : pay}
                  </span>
                </div>
              );
            })}
          </div>
        </Picker>
      )}
      <Cards>
        <Card $c={chainColor(route.from)} data-testid="chain-from">
          <span className="label">Request from:</span> <span className="value">{route.from.name} · {route.networkLabel}</span>
        </Card>
        <Arrow aria-hidden="true">→</Arrow>
        <Card $c={chainColor(route.to)} data-testid="chain-to">
          <span className="label">Court on:</span> <span className="value">{route.to.name} · {route.networkLabel}</span>
        </Card>
      </Cards>
      <Disclosure summary="Network details" data-testid="network-details">
        <Details>
          <dt>{route.fromLabel}</dt>
          <dd>
            chain id {route.from.id} · {route.from.rpcUrl}
          </dd>
          <dt>{route.toLabel}</dt>
          <dd>
            chain id {route.to.id} · {route.to.rpcUrl}
          </dd>
        </Details>
      </Disclosure>
      <Wallet>
        {unavailable ? <NetworkDown error={unavailable} onRetry={onRetry} /> : <WalletStrip gate={gate} />}
      </Wallet>
      {children}
    </Panel>
  );
};
