import React, { createContext, useContext, useState } from "react";
import styled from "styled-components";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Copiable } from "@kleros/ui-components-library";
import type { Address, WalletState } from "../data";
import { describeError, isRejection } from "./errors";
import { shortAddress } from "./format";
import { routeConfig, type WalletGate } from "./route";
import { useSetup } from "./setup";
import { LibButton } from "./ui";

export interface Wallet extends WalletState {
  ready: boolean; // connected to the foreign chain
  hasTestWallet: boolean;
  hasInjected: boolean;
  isTest: boolean; // the connected account is the devnet test wallet
  busy: boolean;
  error: string | null;
  connectTest(): Promise<void>;
  connectInjected(): Promise<void>;
  switchToForeign(): Promise<void>;
  disconnect(): void;
}

function useWalletState(): Wallet {
  const { env, data } = useSetup();
  const route = routeConfig(data.chains());
  const foreignId = route.from.id;
  const account = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [error, setError] = useState<string | null>(null);
  // createWagmiConfig gives the injected connector(s) and, on the devnet build, the dev-account test connector.
  const injected = connectors.find((c) => c.type === "injected");
  const test = env.testWallet
    ? connectors.find((c) => c.type !== "injected")
    : undefined;
  const status: WalletState["status"] =
    account.status === "connected"
      ? account.chainId === foreignId
        ? "connected"
        : "wrong-chain"
      : account.status === "connecting" || account.status === "reconnecting"
        ? "connecting"
        : "disconnected";
  const run = async (f: () => Promise<unknown>, rejected?: string) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(
        rejected && isRejection(e instanceof Error ? e.message : String(e))
          ? rejected
          : describeError(e).text,
      );
    }
  };
  return {
    status,
    address: (account.address as Address | undefined) ?? null,
    chainId: account.chainId ?? null,
    ready: status === "connected",
    hasTestWallet: !!test,
    hasInjected: !!injected,
    isTest: !!test && account.connector?.id === test.id,
    busy: isPending || switching,
    error,
    connectTest: () =>
      run(() => connectAsync({ connector: test!, chainId: foreignId })),
    connectInjected: () =>
      run(async () => {
        if (!injected)
          throw new Error(
            "No browser wallet found. Install one, or use the test wallet on the local demo.",
          );
        try {
          await connectAsync({ connector: injected, chainId: foreignId });
        } catch (e) {
          if (
            /provider not found/i.test(
              e instanceof Error ? e.message : String(e),
            )
          )
            throw new Error(
              "No browser wallet found. Install one, or use the test wallet on the local demo.",
            );
          throw e;
        }
      }),
    switchToForeign: () =>
      run(
        () => switchChainAsync({ chainId: foreignId }),
        `The network switch was cancelled. Switch to ${route.fromLabel} to send.`,
      ),
    disconnect: () => {
      setError(null);
      disconnect();
    },
  };
}

const WalletContext = createContext<Wallet | null>(null);

/** One wallet state for the whole app, so the top bar and the pages show the same account, network and errors. */
export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const w = useWalletState();
  return <WalletContext.Provider value={w}>{children}</WalletContext.Provider>;
};

export function useWallet(): Wallet {
  const w = useContext(WalletContext);
  if (!w) throw new Error("useWallet outside WalletProvider");
  return w;
}

const Row = styled.div`
  display: flex;
  gap: 8px 12px;
  align-items: center;
  flex-wrap: wrap;
`;

const Addr = styled.span`
  font-family: var(--font-code);
  font-size: var(--fs-sm);
  color: var(--text-2);
  padding: 10px 12px;
  border: 1px solid var(--stroke);
  border-radius: var(--r);
  display: inline-block;
`;

const Err = styled.p`
  color: var(--err);
  font-size: var(--fs-sm);
  width: 100%;
`;

const Small = styled.span`
  color: var(--text-2);
  font-size: var(--fs-sm);
`;

/** The wallet strip of the route section: connect, switch network or the connected account, from the gate. */
export const WalletStrip: React.FC<{ gate: WalletGate }> = ({ gate }) => {
  const w = useWallet();
  const { data } = useSetup();
  const route = routeConfig(data.chains());
  if (gate.state === "unavailable") return null;
  if (gate.state === "ready" && w.address)
    return (
      <Row data-testid="wallet">
        <strong data-testid="wallet-state">{gate.message}</strong>
        <Copiable copiableContent={w.address} info="Copy address">
          <Addr title={w.address}>{shortAddress(w.address)}</Addr>
        </Copiable>
        <Small>
          {w.isTest ? "Local demo account · ready to pay" : "Ready to pay"}
        </Small>
        <LibButton
          small
          variant="secondary"
          text="Disconnect"
          type="button"
          onClick={w.disconnect}
        />
      </Row>
    );
  if (gate.state === "wrong-chain")
    return (
      <Row data-testid="wallet">
        <p data-testid="wallet-state" role="status" style={{ width: "100%" }}>
          {gate.message}
        </p>
        <LibButton
          text={`Switch to ${route.fromLabel}`}
          type="button"
          isLoading={w.busy}
          disabled={w.busy}
          onClick={() => void w.switchToForeign()}
          data-testid="switch-chain"
        />
        <LibButton
          small
          variant="secondary"
          text="Disconnect"
          type="button"
          onClick={w.disconnect}
        />
        {w.error && <Err role="alert">{w.error}</Err>}
      </Row>
    );
  return (
    <Row data-testid="wallet">
      {w.hasTestWallet && (
        <span
          style={{
            display: "inline-flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <LibButton
            variant="secondary"
            text="Use test wallet"
            type="button"
            disabled={w.busy}
            isLoading={w.busy}
            onClick={() => void w.connectTest()}
          />
          <Small>Local demo account</Small>
        </span>
      )}
      <LibButton
        variant="secondary"
        text="Connect wallet"
        type="button"
        disabled={w.busy}
        onClick={() => void w.connectInjected()}
      />
      <Small data-testid="wallet-state">{gate.message}</Small>
      {w.error && <Err role="alert">{w.error}</Err>}
    </Row>
  );
};

const Menu = styled.details`
  position: relative;
  summary {
    list-style: none;
    cursor: pointer;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border: 1px solid var(--stroke);
    border-radius: var(--r);
    font-size: var(--fs-sm);
    color: var(--text);
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .bad {
    color: var(--warn);
    font-weight: 600;
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 20;
    min-width: 220px;
    background: var(--surface);
    border: 1px solid var(--stroke-strong);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow);
    padding: 12px;
    display: grid;
    gap: 8px;
    font-size: var(--fs-sm);
  }
`;

/** The compact account and network control of the top bar, with a disconnect menu. Visible at every width. */
export const AccountControl: React.FC = () => {
  const w = useWallet();
  const { data } = useSetup();
  const route = routeConfig(data.chains());
  if (!w.address || w.status === "disconnected" || w.status === "connecting")
    return (
      <span
        data-testid="account-control"
        className="muted"
        style={{ fontSize: "var(--fs-sm)" }}
      >
        {w.status === "connecting" ? "Connecting…" : "Not connected"}
      </span>
    );
  const wrong = w.status === "wrong-chain";
  return (
    <Menu data-testid="account-control">
      <summary aria-label="Account and network">
        <span>{w.isTest ? "Test wallet" : "Wallet"}</span>
        <span className="mono">{shortAddress(w.address)}</span>
        <span className={wrong ? "bad" : undefined}>
          {wrong ? "Wrong network" : "Local"}
        </span>
      </summary>
      <div className="panel">
        <span>
          {wrong
            ? `Switch to ${route.fromLabel} to send.`
            : `On ${route.fromLabel}`}
        </span>
        <Copiable copiableContent={w.address} info="Copy address">
          <Addr title={w.address}>{w.address}</Addr>
        </Copiable>
        <LibButton
          small
          variant="secondary"
          text="Disconnect"
          type="button"
          onClick={w.disconnect}
        />
      </div>
    </Menu>
  );
};
