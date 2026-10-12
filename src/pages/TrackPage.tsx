import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Copiable, Field } from "@kleros/ui-components-library";
import { Link, useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import type { Oracle, StageTx, SwitchRequest } from "../data";
import { BulbSvg } from "../components/Bulb";
import { Circuit } from "../components/Circuit";
import { requestModel } from "../components/circuitModel";
import { plainError } from "../components/errors";
import { clockTime, formatAmount, rulingName, shortAddress, shortHash } from "../components/format";
import { listState } from "../components/route";
import {
  readBulb,
  startHealthPoll,
  trackInitial,
  trackReducer,
  trackView,
  type BulbRead,
} from "../components/readState";
import { routeConfig, walletGate } from "../components/route";
import { useSetup } from "../components/setup";
import { useCopy } from "../components/Toast";
import {
  DECISION_SUBMITTED,
  logEntries,
  nowModel,
  pausedModel,
  STAGE_LABEL,
  txName,
  type EntryState,
  type LogEntry,
} from "../components/trackModel";
import {
  ButtonLink,
  Callout,
  Disclosure,
  Icon,
  LibButton,
  IconButton,
  PageHead,
  Panel,
  PanelHead,
  Pill,
  Shell,
  Swatch,
} from "../components/ui";
import { useWallet, WalletStrip } from "../components/wallet";
import { oracleColor } from "../theme/tokens";

const HEALTH_MS = 4000;

const Head = styled(PageHead)`
  align-items: flex-start;
  flex-wrap: wrap;
  .titles {
    min-width: 0;
    flex: 1 1 240px;
    display: grid;
    gap: 4px;
  }
  .find {
    flex: none;
    white-space: nowrap;
  }
  .find button {
    white-space: nowrap;
  }
`;

const NowPanel = styled(Panel)`
  display: flex;
  gap: 20px;
  align-items: flex-start;
  flex-wrap: wrap;
  margin-bottom: var(--gap);
  h2 {
    font-size: var(--fs-xl);
  }
  .main {
    flex: 1 1 280px;
    min-width: 0;
  }
  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 14px 0 0;
    font-size: var(--fs-sm);
  }
  .meta dt {
    color: var(--text-2);
  }
  .meta dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  button {
    white-space: nowrap;
  }
  @media (max-width: 640px) {
    gap: 10px;
    flex-wrap: nowrap;
    h2 {
      font-size: var(--fs-lg);
    }
    > svg {
      width: 60px;
      height: 72px;
    }
    .main {
      flex-basis: 0;
    }
  }
`;

const Status = styled.span<{ $tone: "live" | "ok" | "err" }>`
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-weight: 600;
  color: ${({ $tone }) => ($tone === "ok" ? "var(--ok)" : $tone === "err" ? "var(--err)" : "var(--blue)")};
  svg {
    width: 16px;
    height: 16px;
  }
`;

const Simulate = styled.div`
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px dashed var(--warn);
  border-radius: var(--r-lg);
  background: var(--warn-bg);
  display: grid;
  gap: 10px;
  .row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }
  .row > button {
    min-width: 120px;
    min-height: 44px;
  }
`;

const Paused = styled.div`
  margin-top: 12px;
  display: grid;
  gap: 8px;
  font-size: var(--fs-sm);
  p {
    color: var(--text-2);
  }
  .warn {
    color: var(--err);
    font-weight: 600;
  }
`;

const Below = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gap);
  align-items: start;
  > section {
    min-width: 0;
    grid-column: auto;
  }
  @media (min-width: 1024px) {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    .record {
      position: sticky;
      top: calc(var(--bar-h, 0px) + var(--gap));
      max-height: calc(100vh - var(--bar-h, 0px) - 2 * var(--gap));
      overflow: auto;
    }
  }
  .record {
    scroll-margin-top: calc(var(--bar-h, 0px) + var(--gap));
  }
`;

const Switch = styled.div`
  display: inline-flex;
  border: 1px solid var(--stroke-strong);
  border-radius: var(--r);
  overflow: hidden;
  button {
    min-height: 44px;
    min-width: 88px;
    padding: 0 16px;
    background: transparent;
    border: 0;
    color: var(--text-2);
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  button + button {
    border-left: 1px solid var(--stroke-strong);
  }
  button[aria-pressed="true"] {
    background: var(--tint);
    color: var(--text);
    box-shadow: inset 0 -3px 0 var(--purple-2);
  }
`;

const FindBox = styled.dialog`
  border: 1px solid var(--stroke-strong);
  border-radius: var(--r-lg);
  background: var(--surface);
  color: var(--text);
  padding: 0;
  width: min(480px, calc(100% - 32px));
  max-height: calc(100dvh - 32px);
  box-shadow: var(--shadow);
  &::backdrop {
    background: var(--backdrop);
  }
  .in {
    padding: 20px;
    display: grid;
    gap: 16px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  li a {
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--stroke);
    border-radius: var(--r);
    color: var(--text);
    text-decoration: none;
  }
  li a[aria-current="page"] {
    border-color: var(--purple-2);
    background: var(--tint);
  }
`;

const Log = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: var(--fs-sm);
  > li {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    padding: 10px;
    border-radius: var(--r);
  }
  > li.cur {
    background: var(--tint);
    box-shadow: inset 0 0 0 1px var(--stroke-strong);
  }
  > li.todo {
    color: var(--text-2);
  }
  > li.fail .ev {
    color: var(--err);
  }
  .ev {
    font-weight: 600;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .ev svg {
    width: 16px;
    height: 16px;
    flex: none;
  }
  li.done > .ev svg {
    color: var(--ok);
  }
  .tm {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  details {
    margin-top: 2px;
  }
  summary {
    cursor: pointer;
    min-height: 44px;
    display: flex;
    align-items: center;
    color: var(--blue);
    font-weight: 600;
  }
  .reports {
    list-style: none;
    padding: 0 0 0 4px;
    margin: 0;
    display: grid;
    gap: 2px;
  }
  .reports li {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 32px;
  }
  .reports svg {
    width: 16px;
    height: 16px;
    flex: none;
  }
  .reports li.done svg {
    color: var(--ok);
  }
  .reports li.fail {
    color: var(--err);
  }
  .reports li.skip,
  .reports li.todo {
    color: var(--text-2);
  }
`;

const TxButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid var(--stroke);
  border-radius: var(--r);
  background: transparent;
  color: var(--blue);
  font: inherit;
  font-size: var(--fs-sm);
  cursor: copy;
  .h {
    font-family: var(--font-code);
    font-size: 0.8125rem;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
`;

const TxRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
`;

const Facts = styled.dl`
  display: grid;
  grid-template-columns: 9rem minmax(0, 1fr);
  gap: 10px 12px;
  margin: 0;
  font-size: var(--fs-sm);
  dt {
    color: var(--text-2);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  @media (max-width: 420px) {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
    dd {
      margin-bottom: 8px;
    }
  }
`;

const Strands = styled.span`
  display: flex;
  gap: 6px 14px;
  flex-wrap: wrap;
  span {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
`;

const Picker = styled.div`
  display: grid;
  gap: 10px;
  min-width: min(100%, 300px);
  .lbl {
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  form {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  form > button {
    min-height: 44px;
  }
  .msg {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
`;

const ChainTag = styled.span`
  font-size: var(--fs-sm);
  color: var(--text-2);
  font-weight: 400;
`;

const TxCopy: React.FC<{ tx: StageTx; testId?: string }> = ({ tx, testId }) => {
  const copy = useCopy();
  return (
    <TxButton
      type="button"
      onClick={() => copy(tx.hash, "Transaction hash copied")}
      aria-label={`Copy ${txName(tx)} transaction hash ${tx.hash}`}
      data-testid={testId}
      data-hash={tx.hash}
      title={tx.hash}
    >
      {txName(tx)} <span className="h">tx {shortHash(tx.hash)}</span>
    </TxButton>
  );
};

/** Look up a request by its number, with a persistent label and inline validation. */
const OpenById: React.FC<{ onGo?: () => void }> = ({ onGo }) => {
  const nav = useNavigate();
  const [v, setV] = useState("");
  const value = v.trim();
  const invalid = value !== "" && !/^\d+$/.test(value);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value && !invalid) {
          nav(`/track/${value}`);
          onGo?.();
        }
      }}
      noValidate
    >
      <div style={{ flex: 1 }}>
        <label htmlFor="open-id" className="lbl">
          Request ID
        </label>
        <Field
          id="open-id"
          placeholder="For example 1"
          inputMode="numeric"
          value={v}
          variant={invalid ? "error" : undefined}
          message={invalid ? "Use digits only, for example 1." : undefined}
          onChange={(e) => setV(e.target.value)}
        />
      </div>
      <LibButton
        variant="secondary"
        text="Open"
        type="submit"
        disabled={!value || invalid}
        style={{ marginTop: 24 }}
      />
    </form>
  );
};

function useOracles(): Oracle[] {
  const { data } = useSetup();
  const [oracles, setOracles] = useState<Oracle[]>([]);
  useEffect(() => {
    data.oracles().then(setOracles, () => setOracles([]));
  }, [data]);
  return oracles;
}

/** The connected wallet's requests, newest first, with loading, failed and empty told apart. */
function useMyRequests(stage?: string) {
  const { data } = useSetup();
  const wallet = useWallet();
  const [items, setItems] = useState<SwitchRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!wallet.ready || !wallet.address) {
      setItems(null);
      setError(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    data
      .requests(wallet.address)
      .then((l) => live && setItems(l))
      .catch((e) => live && setError(plainError(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [data, wallet.ready, wallet.address, stage, tick]);
  return { items, error, loading, retry: () => setTick((t) => t + 1), state: listState({ loading, error, items }) };
}

const FindBody: React.FC<{ current?: bigint; stage?: string; onClose: () => void }> = ({ current, stage, onClose }) => {
  const wallet = useWallet();
  const list = useMyRequests(stage);
  return (
    <div className="in">
      <div className="top">
        <h2 id="find-h">Find or switch request</h2>
        <IconButton type="button" aria-label="Close" onClick={onClose}>
          <Icon.close />
        </IconButton>
      </div>
      <Picker>
        <OpenById onGo={onClose} />
        {!wallet.ready ? (
          <p className="msg">Connect a wallet to list your own requests.</p>
        ) : list.state === "loading" ? (
          <p className="msg" role="status">
            Loading your requests…
          </p>
        ) : list.state === "failed" ? (
          <div role="alert" className="msg">
            <p>Could not load your requests. {list.error}</p>
            <LibButton small variant="secondary" text="Retry" type="button" onClick={list.retry} data-testid="retry-list" />
          </div>
        ) : list.state === "empty" ? (
          <p className="msg" data-testid="list-empty">
            No requests from this wallet yet.
          </p>
        ) : (
          <div data-testid="my-requests">
            <span className="lbl" id="mine-h">
              Your requests
            </span>
            <ul aria-labelledby="mine-h">
              {(list.items ?? []).map((r) => (
                <li key={r.disputeId.toString()}>
                  <Link
                    to={`/track/${r.disputeId}`}
                    onClick={onClose}
                    aria-current={current === r.disputeId ? "page" : undefined}
                    data-testid={`request-option-${r.disputeId}`}
                  >
                    Request #{r.disputeId.toString()} ·{" "}
                    {r.stage === "switched" ? `Ruled ${r.ruling === 1 ? "On" : "Off"}` : STAGE_LABEL[r.stage]}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Picker>
    </div>
  );
};

/** One "Find or switch request" button that opens one panel with the request-ID field and "Your requests". */
const FindRequest: React.FC<{ current?: bigint; stage?: string }> = ({ current, stage }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <div className="find">
      <LibButton
        variant="secondary"
        text="Find or switch request"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid="find-request"
      />
      <FindBox
        ref={ref}
        aria-labelledby="find-h"
        data-testid="find-dialog"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false);
        }}
      >
        {open && <FindBody current={current} stage={stage} onClose={() => setOpen(false)} />}
      </FindBox>
    </div>
  );
};

/** `/track` without an id: the wallet's latest request. */
const Latest: React.FC = () => {
  const wallet = useWallet();
  const nav = useNavigate();
  const { data } = useSetup();
  const route = routeConfig(data.chains());
  const list = useMyRequests();
  useEffect(() => {
    if (list.items && list.items.length) nav(`/track/${list.items[0].disputeId.toString()}`, { replace: true });
  }, [list.items, nav]);
  const gate = walletGate({ networkUp: true, status: wallet.status, chainId: wallet.chainId, route });
  return (
    <Shell>
      <PageHead>
        <div>
          <h1>Track a request</h1>
          <p>Follow a request from sending to the court's decision and the bulb.</p>
        </div>
      </PageHead>
      <Panel>
        {!wallet.ready ? (
          <>
            <h2>Connect to see your latest request</h2>
            <p className="sub" style={{ margin: "6px 0 12px" }}>
              Or open any request by its ID. No wallet is needed to follow one.
            </p>
            <WalletStrip gate={gate} />
          </>
        ) : list.state === "loading" ? (
          <p className="muted" role="status">
            Loading your requests…
          </p>
        ) : list.state === "failed" ? (
          <Callout tone="err" title="Could not load your requests">
            <p>{list.error}</p>
            <p style={{ marginTop: 8 }}>
              <LibButton small text="Retry" type="button" onClick={list.retry} data-testid="retry-list" />
            </p>
          </Callout>
        ) : (
          <>
            <h2>No requests yet</h2>
            <p className="sub" style={{ margin: "6px 0 12px" }}>
              This wallet has not sent a request.
            </p>
            <ButtonLink to="/">Send a request</ButtonLink>
          </>
        )}
        <div style={{ marginTop: 16 }}>
          <Picker>
            <OpenById />
          </Picker>
        </div>
      </Panel>
    </Shell>
  );
};

const SimulateCourt: React.FC<{ req: SwitchRequest; onSent: () => void }> = ({ req, onSent }) => {
  const { data } = useSetup();
  const [busy, setBusy] = useState<1 | 2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data.devnet) return null;
  const devnet = data.devnet;
  const rule = async (r: 1 | 2) => {
    setBusy(r);
    setError(null);
    try {
      await devnet.rule(req.disputeId, r);
      onSent();
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Simulate data-testid="devnet-rule">
      <div className="row">
        <Pill $tone="warn" data-testid="local-demo-label">
          Local demo
        </Pill>
      </div>
      <div className="row">
        <LibButton text="Decide On" type="button" disabled={!!busy} isLoading={busy === 1} onClick={() => void rule(1)} />
        <LibButton text="Decide Off" type="button" disabled={!!busy} isLoading={busy === 2} onClick={() => void rule(2)} />
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--err)", fontSize: "var(--fs-sm)" }}>
          {error}
        </p>
      )}
    </Simulate>
  );
};

const stateIcon = (s: EntryState) =>
  s === "done" ? <Icon.check /> : s === "fail" ? <Icon.alert /> : s === "cur" ? <Icon.clock /> : null;

const STATE_WORD: Record<EntryState, string> = {
  done: "Done",
  cur: "In progress",
  todo: "Not yet",
  fail: "Paused",
  skip: "Not needed",
};

const EntryRow: React.FC<{
  e: LogEntry;
  reports: LogEntry[];
  seen: number | undefined;
  names: { foreign: string; home: string };
}> = ({ e, reports, seen, names }) => {
  const doneReports = reports.filter((r) => r.report?.status === "reported").length;
  return (
    <li className={e.state} data-testid={`log-${e.key}`} data-state={e.state} aria-current={e.state === "cur" ? "step" : undefined}>
      <span className="ev">
        {stateIcon(e.state)}
        <span data-testid="stage-title">{e.title}</span>
        <ChainTag>{e.chain === "foreign" ? names.foreign : names.home}</ChainTag>
        <span className="visually-hidden">{STATE_WORD[e.state]}</span>
      </span>
      {(e.state === "done" || e.state === "fail") && (
        <span className="tm">{seen ? `Observed at ${clockTime(seen)}` : "Completed before this page opened"}</span>
      )}
      {reports.length > 0 && e.state !== "todo" && (
        <details>
          <summary>
            Oracle reports · {doneReports} of {reports.length}
          </summary>
          <ul className="reports">
            {reports.map((r) => (
              <li
                key={r.key}
                className={r.state}
                data-testid={r.key}
                data-state={r.state}
                data-status={r.report?.status}
              >
                {stateIcon(r.state)}
                <span>{r.title}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {e.txs.length > 0 && e.state !== "todo" && (
        <details>
          <summary>Transaction details</summary>
          <TxRow>
            {e.txs.map((t) => (
              <TxCopy key={t.hash + t.label} tx={t} testId={`log-tx-${e.key}`} />
            ))}
          </TxRow>
        </details>
      )}
    </li>
  );
};

const VIEW_KEY = "veashi.track.view";
type View = "steps" | "circuit";
const readView = (): View => {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "circuit" ? "circuit" : "steps";
  } catch {
    return "steps";
  }
};

const Tracked: React.FC<{ id: bigint }> = ({ id }) => {
  const { data, env } = useSetup();
  const route = useMemo(() => routeConfig(data.chains()), [data]);
  const names = { foreign: route.from.name, home: route.to.name };
  const oracles = useOracles();
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
  };
  const [tracked, dispatch] = useReducer(trackReducer, trackInitial);
  const { req } = tracked;
  const wallet = useWallet();
  const [usdcDecimals, setUsdcDecimals] = useState(6);
  const [ruled, setRuled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const seen = useRef(new Map<string, number>());
  const firstRender = useRef(true);

  const load = useCallback(() => {
    return data.request(id).then(
      (r) => dispatch({ type: "loaded", req: r }),
      (e) => dispatch({ type: "failed", error: plainError(e) }),
    );
  }, [data, id]);

  useEffect(() => {
    let live = true;
    dispatch({ type: "reset" });
    setRuled(false);
    seen.current = new Map();
    firstRender.current = true;
    data.request(id).then(
      (r) => live && dispatch({ type: "loaded", req: r }),
      (e) => live && dispatch({ type: "failed", error: plainError(e) }),
    );
    const stop = data.watchRequest(id, (r) => live && dispatch({ type: "loaded", req: r }));
    return () => {
      live = false;
      stop();
    };
  }, [data, id]);

  // watchRequest cannot report that it stalled, so a periodic read beside it feeds the same error state until the
  // bulb has switched; a success (here or from the subscription) clears the error.
  const done = req?.stage === "switched";
  useEffect(() => {
    if (req === undefined || req === null || done) return;
    return startHealthPoll(
      () => data.request(id),
      HEALTH_MS,
      (r) => dispatch({ type: "loaded", req: r }),
      (e) => dispatch({ type: "failed", error: plainError(e) }),
    );
  }, [data, id, done, req === undefined || req === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (req?.paid.token === "usdc")
      data.quote(null, "usdc").then(
        (q) => setUsdcDecimals(q.decimals),
        () => {},
      );
  }, [data, req?.paid.token]);

  // The wallet's current bulb, read from the same source as the Request page, once the request has switched it.
  // null while the read is pending; "failed" once a few short retries were rejected. Never inferred from the ruling.
  const [bulbStored, setBulbStored] = useState<{ owner: string; read: BulbRead } | null>(null);
  const [bulbTry, setBulbTry] = useState(0);
  const owner = req?.owner;
  const switched = req?.stage === "switched";
  useEffect(() => {
    if (!owner || !switched) return;
    let live = true;
    const stop = readBulb(
      data,
      owner,
      () => live,
      (read) => setBulbStored({ owner, read }),
    );
    return () => {
      live = false;
      stop();
    };
  }, [data, owner, switched, req?.updatedAt, bulbTry]);
  // what was read for another request's owner is not shown; unknown is neither on nor off
  const bulbRead: BulbRead =
    owner && bulbStored && bulbStored.owner === owner ? bulbStored.read : { kind: "loading" };
  const mine = !!owner && !!wallet.address && wallet.address.toLowerCase() === owner.toLowerCase();

  const model = useMemo(() => (req ? requestModel(req, oracles, names, bulbRead, mine) : null), [req, oracles, route, bulbRead, mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const entries = useMemo(() => (req ? logEntries(req, oracles, names) : []), [req, oracles, route]); // eslint-disable-line react-hooks/exhaustive-deps
  // Times are when this page saw each step happen; steps already done when it opened were completed before.
  const now = Date.now();
  for (const e of entries)
    if ((e.state === "done" || e.state === "fail") && !seen.current.has(e.key))
      seen.current.set(e.key, firstRender.current ? 0 : now);
  if (req) firstRender.current = false;

  const head = (title: React.ReactNode, status?: React.ReactNode) => (
    <Head>
      <div className="titles">
        <h1 data-testid="track-title">{title}</h1>
        {status}
      </div>
      <FindRequest current={id} stage={req?.stage} />
    </Head>
  );

  const tv = trackView(tracked);
  if (tv.kind === "error")
    return (
      <Shell>
        {head(`Request #${id.toString()}`)}
        <Callout tone="err" title="Could not read this request">
          <p>{tv.message}</p>
          <p style={{ marginTop: 8 }}>
            <LibButton
              small
              variant="secondary"
              text="Retry loading request"
              type="button"
              onClick={() => {
                dispatch({ type: "retry" });
                void load();
              }}
              data-testid="retry-request"
            />
          </p>
        </Callout>
      </Shell>
    );
  if (req === undefined)
    return (
      <Shell>
        {head(`Request #${id.toString()}`)}
        <p className="muted" role="status">
          Loading the request…
        </p>
      </Shell>
    );
  if (req === null)
    return (
      <Shell>
        {head(`No request #${id.toString()}`)}
        <Panel>
          <p className="sub">There is no request with this ID on {names.foreign}.</p>
        </Panel>
      </Shell>
    );

  const canSimulate = !!data.devnet;
  let n = nowModel(req, oracles, names, { canSimulate, bulb: bulbRead, mine });
  if (ruled && req.stage === "dispute-received")
    n = {
      ...n,
      title: DECISION_SUBMITTED,
      body: "The automatic relay service starts the return delivery.",
      statusText: "Decision submitted",
      next: "Automatic return delivery",
      action: null,
    };
  const paused = req.stage === "failed" ? pausedModel(req, names) : null;
  const tokenDecimals = req.paid.token === "usdc" ? usdcDecimals : 18;
  const symbol = req.paid.token === "usdc" ? "USDC" : "ETH";
  const oName = (oid: number) => oracles.find((o) => o.id === oid)?.name ?? `Oracle ${oid}`;
  const doneCount = entries.filter((e) => !e.report && e.state === "done").length;
  const bulb = model?.bulb ?? "waiting";
  const stageEntries = entries.filter((e) => !e.report);
  const reportsFor = (key: string) =>
    entries.filter((e) => e.report && e.report.leg === (key === "dispute-relaying" ? "dispute" : "ruling"));

  const statusLine = (
    <Status $tone={n.status} data-testid="track-stage" data-stage={req.stage}>
      {n.status === "ok" ? <Icon.check /> : n.status === "err" ? <Icon.alert /> : <Icon.clock />}
      {n.statusText}
      {n.counts ? ` · ${n.counts}` : ""}
    </Status>
  );

  return (
    <Shell>
      {head(`Request #${req.disputeId.toString()}`, statusLine)}

      {tv.kind === "request" && tv.banner && (
        <div style={{ marginBottom: "var(--gap)" }}>
          <Callout tone="warn" title={tv.banner} data-testid="stale-banner">
            <p>
              <LibButton
                small
                variant="secondary"
                text="Retry loading request"
                type="button"
                onClick={() => {
                  dispatch({ type: "retry" });
                  void load();
                }}
                data-testid="retry-request"
              />
            </p>
          </Callout>
        </div>
      )}

      <NowPanel aria-label="Current status" data-testid="now" aria-live="polite">
        <BulbSvg state={bulb} />
        <div className="main">
          <p className="visually-hidden" data-testid="bulb-state-text">{`Bulb is ${bulb === "waiting" ? "waiting for the decision" : bulb === "unknown" ? (bulbRead.kind === "failed" ? "unavailable, the check failed" : "being checked") : bulb}`}</p>
          <h2 data-testid="now-title">{n.title}</h2>
          <p className="sub" style={{ marginTop: 6 }}>
            {n.body}
          </p>
          <dl className="meta">
            {n.bulbNow && (
              <>
                <dt>{n.bulbNow.label}</dt>
                <dd data-testid="bulb-now">
                  {n.bulbNow.value}
                  {n.bulbNow.differs && <span className="differs"> · {n.bulbNow.differs}</span>}
                </dd>
              </>
            )}
            <dt>Next</dt>
            <dd>{n.next}</dd>
          </dl>
          {n.action === "simulate" && <SimulateCourt req={req} onSent={() => setRuled(true)} />}
          {paused && (
            <Paused data-testid="paused">
              <p>
                <strong>Last successful step:</strong> {paused.lastStep}
              </p>
              <p>{paused.operatorAction}</p>
              <p className="warn">{paused.warning}</p>
              <div>
                <LibButton
                  small
                  variant="secondary"
                  text="Refresh status"
                  type="button"
                  isLoading={refreshing}
                  disabled={refreshing}
                  onClick={() => {
                    setRefreshing(true);
                    void load().finally(() => setRefreshing(false));
                  }}
                  data-testid="refresh-status"
                />
              </div>
              {paused.detail && (
                <Disclosure summary="Technical details">
                  <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{paused.detail}</pre>
                </Disclosure>
              )}
            </Paused>
          )}
          {req.stage === "switched" && bulbRead.kind === "failed" && (
            <p style={{ marginTop: 14 }}>
              <LibButton small variant="secondary" text="Retry bulb check" type="button" onClick={() => setBulbTry((x) => x + 1)} data-testid="bulb-retry" />
            </p>
          )}
          {req.stage === "switched" && (
            <p style={{ marginTop: 14 }}>
              <ButtonLink to="/">Send another request</ButtonLink>
            </p>
          )}
        </div>
      </NowPanel>

      <Below>
        <Panel aria-labelledby="progress-h" data-testid="progress">
          <PanelHead>
            <div>
              <h2 id="progress-h">Progress</h2>
              <p>{doneCount} of 6 steps done. Open a step for its oracle reports and transactions.</p>
            </div>
            <Switch role="group" aria-label="Show progress as">
              <button type="button" aria-pressed={view === "steps"} onClick={() => setView("steps")} data-testid="toggle-steps">
                Steps
              </button>
              <button type="button" aria-pressed={view === "circuit"} onClick={() => setView("circuit")} data-testid="toggle-circuit">
                Circuit
              </button>
            </Switch>
          </PanelHead>
          {view === "steps" ? (
            <div data-testid="lifecycle-summary">
              <Log data-testid="event-log" aria-label="Steps of this request">
                {stageEntries.map((e) => (
                  <EntryRow
                    key={e.key}
                    e={e}
                    reports={e.key === "dispute-relaying" || e.key === "ruling-relaying" ? reportsFor(e.key) : []}
                    seen={seen.current.get(e.key) || undefined}
                    names={names}
                  />
                ))}
              </Log>
            </div>
          ) : (
            model && (
              <Circuit
                model={model}
                names={names}
                label={`Circuit of request ${req.disputeId} from ${names.foreign} to Kleros Court on ${names.home} and back. ${n.title}`}
              />
            )
          )}
        </Panel>

        <Panel className="record" id="track-route" aria-labelledby="facts-h">
          <PanelHead>
            <div>
              <h2 id="facts-h">Request summary</h2>
            </div>
          </PanelHead>
          <Facts data-testid="dispute-record">
            <dt>Route</dt>
            <dd data-testid="record-route">{`${names.foreign} → ${names.home} → ${names.foreign} · Local devnet`}</dd>
            <dt>Paid</dt>
            <dd className="mono">{formatAmount(req.paid.amount, tokenDecimals, symbol)}</dd>
            <dt>Requester</dt>
            <dd>
              <Copiable copiableContent={req.owner} info="Copy address">
                <span className="mono" title={req.owner}>
                  {shortAddress(req.owner)}
                </span>
              </Copiable>
            </dd>
            <dt>Selected oracles</dt>
            <dd>
              <Strands>
                {req.selection.oracleIds.map((oid) => (
                  <span key={oid}>
                    <Swatch $color={oracleColor(oid)} />
                    {oName(oid)}
                  </span>
                ))}
              </Strands>
            </dd>
            <dt>Agreement</dt>
            <dd>
              {req.selection.threshold} of {req.selection.oracleIds.length} must agree
            </dd>
            <dt>Decision</dt>
            <dd data-testid="ruling">{req.ruling === 0 ? "Not decided yet" : rulingName(req.ruling)}</dd>
            <dt>Request ID</dt>
            <dd data-testid="request-id">
              #{req.disputeId.toString()} · {names.foreign}
            </dd>
            <dt>Court case ID</dt>
            <dd data-testid="home-dispute">
              {req.homeDisputeId !== null ? `#${req.homeDisputeId.toString()} · ${names.home}` : "Not created yet"}
            </dd>
          </Facts>
          <Disclosure summary="Technical details" data-testid="technical-details">
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <h3>Contracts</h3>
                <p className="mono">
                  ForeignGateway {env.addresses.foreign.ForeignGateway ?? ""} · {names.foreign} · dispute #
                  {req.disputeId.toString()}
                </p>
                <p className="mono" data-testid="tech-home">
                  HomeGateway {env.addresses.home.HomeGateway ?? ""} · KlerosCoreRuler {env.addresses.home.KlerosCoreRuler ?? ""} ·{" "}
                  {names.home} · {req.homeDisputeId !== null ? `dispute #${req.homeDisputeId.toString()}` : "not created yet"}
                </p>
              </div>
              <div>
                <h3>Oracles</h3>
                {req.selection.oracleIds.map((oid) => (
                  <p key={oid} className="mono">
                    {oName(oid)} · oracle id {oid} · {oracles.find((o) => o.id === oid)?.via ?? ""}
                  </p>
                ))}
              </div>
              <div>
                <h3>Calls</h3>
                {stageEntries.map((e) => (
                  <p key={e.key} className="mono">
                    {e.title}: {e.tech}
                  </p>
                ))}
                <p className="mono">Ruling code {req.ruling} (1 = On, 2 = Off)</p>
                {req.stage === "switched" && (
                  <p className="mono">
                    LightbulbSwitched({shortAddress(req.owner)}, {req.disputeId.toString()}, {req.ruling === 1 ? "true" : "false"})
                  </p>
                )}
              </div>
              <div>
                <h3>Transactions</h3>
                {req.txs.length === 0 && <p>None yet.</p>}
                <TxRow style={{ display: "grid" }}>
                  {req.txs.map((t) => (
                    <span key={t.hash + t.label} className="mono" data-testid="tech-tx" data-hash={t.hash} data-stage={t.stage}>
                      {t.chain === "foreign" ? names.foreign : names.home} · {t.label} · {t.hash}
                    </span>
                  ))}
                </TxRow>
              </div>
            </div>
          </Disclosure>
        </Panel>
      </Below>
    </Shell>
  );
};

export const TrackPage: React.FC = () => {
  const { disputeId } = useParams();
  if (disputeId === undefined) return <Latest />;
  if (!/^\d+$/.test(disputeId))
    return (
      <Shell>
        <PageHead>
          <h1>Not a request ID</h1>
        </PageHead>
        <Panel>
          <p className="sub">Request IDs are whole numbers.</p>
          <Picker>
            <OpenById />
          </Picker>
        </Panel>
      </Shell>
    );
  return <Tracked id={BigInt(disputeId)} />;
};
