import React from "react";
import { TESTNET_BUILD as isTestnetBuild } from "./setup";
import { Callout, LibButton } from "./ui";

/** The page heading and lead sentence for a failed start: devnet copy locally, testnet copy on the deployed site. */
export function setupCopy(): { heading: string; lede: string } {
  if (!isTestnetBuild) {
    return { heading: "Local network unavailable", lede: "This app talks only to contracts on a local two-chain demo network." };
  }
  return { heading: "Test network unavailable", lede: "This app talks only to contracts on public test networks." };
}

export const NetworkDown: React.FC<{ error: string; onRetry: () => void }> = ({ error, onRetry }) => {
  if (!isTestnetBuild) {
    return (
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
  }
  return (
    <Callout tone="err" title="Test network unavailable" data-testid="setup-error">
      <p>Transactions are disabled until the test networks answer. Check your connection, then retry.</p>
      <details style={{ marginTop: 8 }}>
        <summary>Why it failed</summary>
        <p>{error}</p>
      </details>
      <p style={{ marginTop: 12 }}>
        <LibButton small text="Retry" type="button" onClick={onRetry} data-testid="retry-network" />
      </p>
    </Callout>
  );
};
