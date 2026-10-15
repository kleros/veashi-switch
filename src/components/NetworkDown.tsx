import React from "react";
import { Callout, LibButton } from "./ui";

export const NetworkDown: React.FC<{ error: string; onRetry: () => void }> = ({ error, onRetry }) => (
  <Callout tone="err" title="Local network unavailable" data-testid="setup-error">
    <p>Transactions are disabled until the local demo network answers. This app never falls back to a public network.</p>
    <p style={{ marginTop: 8 }}>
      Start it with <code>yarn devnet</code>, then retry.
    </p>
    <details style={{ marginTop: 8 }}>
      <summary>Why it failed</summary>
      <p>{error}</p>
    </details>
    <p style={{ marginTop: 12 }}>
      <LibButton small text="Retry" type="button" onClick={onRetry} data-testid="retry-network" />
    </p>
  </Callout>
);
