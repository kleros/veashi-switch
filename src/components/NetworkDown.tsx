import React from "react";
import { NOT_CONFIGURED_PREFIX } from "../data/env";
import { TESTNET_BUILD as isTestnetBuild } from "./setup";
import { Callout, LibButton } from "./ui";

/** The page heading and lead sentence for a failed start: devnet copy locally, testnet copy on the deployed site. */
export function setupCopy(error: string): { heading: string; lede: string } {
  if (!isTestnetBuild) {
    return { heading: "Local network unavailable", lede: "This app talks only to contracts on a local two-chain demo network." };
  }
  if (error.startsWith(NOT_CONFIGURED_PREFIX)) {
    return {
      heading: "Not connected to contracts yet",
      lede: "This site is live, but the Veashi contracts on the test networks have not been set up here yet.",
    };
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
  const notConfigured = error.startsWith(NOT_CONFIGURED_PREFIX);
  return (
    <Callout
      tone={notConfigured ? "info" : "err"}
      title={notConfigured ? "Not connected to contracts yet" : "Test network unavailable"}
      data-testid="setup-error"
    >
      <p>
        {notConfigured
          ? "Nothing can be requested or tracked until the contracts are deployed and their addresses are added to the site's configuration. Check back soon."
          : "Transactions are disabled until the test networks answer. Check your connection, then retry."}
      </p>
      <details style={{ marginTop: 8 }}>
        <summary>{notConfigured ? "What is missing" : "Why it failed"}</summary>
        <p>{error}</p>
      </details>
      {!notConfigured && (
        <p style={{ marginTop: 12 }}>
          <LibButton small text="Retry" type="button" onClick={onRetry} data-testid="retry-network" />
        </p>
      )}
    </Callout>
  );
};
