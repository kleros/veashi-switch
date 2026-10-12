import React from "react";
import styled from "styled-components";
import type { WalletGate } from "./route";
import { Disclosure, Panel, PanelHead } from "./ui";
import { NetworkDown } from "./NetworkDown";
import { useRoute } from "./setup";
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

/** "1 · Network route": the one fixed local route, the local-only boundary and the wallet state. */
export const RouteSection: React.FC<{
  gate: WalletGate;
  unavailable: string | null;
  onRetry: () => void;
  children?: React.ReactNode;
}> = ({ gate, unavailable, onRetry, children }) => {
  const route = useRoute();
  return (
    <Panel id="network-route" style={{ scrollMarginTop: "calc(var(--bar-h, 0px) + 8px)" }} aria-labelledby="route-h" data-testid="route-section">
      <PanelHead>
        <div>
          <h2 id="route-h" data-step-heading>
            Network route
          </h2>
          <p>The ruling returns to {route.from.name}. Only this local route is available.</p>
        </div>
        <Badge data-testid="local-badge">
          Local devnet only
          <small>No public networks or testnets</small>
        </Badge>
      </PanelHead>
      <Cards>
        <Card $c="#0052ff" data-testid="chain-from">
          <span className="label">Request from:</span> <span className="value">{route.from.name} · Local devnet</span>
        </Card>
        <Arrow aria-hidden="true">→</Arrow>
        <Card $c="#28a0f0" data-testid="chain-to">
          <span className="label">Court on:</span> <span className="value">{route.to.name} · Local devnet</span>
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
