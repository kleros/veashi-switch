import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Checkbox, Copiable, Radio } from "@kleros/ui-components-library";
import { useLocation } from "react-router-dom";
import styled, { css, keyframes } from "styled-components";
import type {
  CostQuote,
  Oracle,
  OracleSelection,
  PayToken,
  SelectionError,
  SwitchRequest,
} from "../data";
import { Circuit } from "../components/Circuit";
import { previewModel } from "../components/circuitModel";
import { AGREEMENT_HINT, REQUEST_INTRO } from "../components/copy";
import { costBreakdown } from "../components/costModel";
import {
  plainError,
  sendFailure,
  type SendFailure,
} from "../components/errors";
import { shortHash } from "../components/format";
import {
  costStatus,
  readBulb,
  resolveBulbRead,
  submissionActions,
  type BulbRead,
} from "../components/readState";
import { RouteSection } from "../components/RouteSection";
import { NetworkDown } from "../components/NetworkDown";
import { quoteMatches, routeConfig, walletGate } from "../components/route";
import { useSetup } from "../components/setup";
import {
  ButtonLink,
  Callout,
  Disclosure,
  FieldError,
  Icon,
  LibButton,
  PageHead,
  Panel,
  PanelHead,
  Shell,
  Swatch,
} from "../components/ui";
import { useWallet, WalletStrip } from "../components/wallet";
import { oracleColor } from "../theme/tokens";

/** One column at every width: the step carousel, then the Route preview under it at full width. */
const Layout = styled.div`
  display: grid;
  gap: var(--gap-card);
  grid-template-columns: minmax(0, 1fr);
`;

/** Full width under the carousel; the diagram stops growing at a readable size and stays centred. */
const Side = styled.div`
  min-width: 0;
  [data-testid="circuit"] {
    max-width: 960px;
    margin: 0 auto;
    display: block;
  }
`;

const Main = styled.form`
  display: grid;
  gap: var(--gap);
  min-width: 0;
`;

const Progress = styled.nav`
  display: grid;
  gap: 8px;
  .count {
    font-size: var(--fs-sm);
    color: var(--text-2);
    font-weight: 600;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }
  button {
    width: 100%;
    min-height: 44px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 4px 2px;
    background: transparent;
    border: 0;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    outline: 0;
    color: var(--text-3);
  }
  button[aria-current="step"] {
    color: var(--text);
  }
  button[aria-current="step"] .n {
    background: var(--purple);
    border-color: var(--purple);
    color: var(--on-accent);
  }
  .n {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid var(--stroke-strong);
    font-size: var(--fs-sm);
  }
  .n:empty::before {
    content: attr(data-n);
  }
  button.done .n {
    background: var(--ok-bg);
    color: var(--ok);
    border-color: transparent;
  }
  button.done .n svg {
    width: 14px;
    height: 14px;
  }
`;

const slideFromRight = keyframes`
  from { opacity: 0; transform: translateX(28px); }
  to { opacity: 1; transform: none; }
`;
const slideFromLeft = keyframes`
  from { opacity: 0; transform: translateX(-28px); }
  to { opacity: 1; transform: none; }
`;

/** Only the active step is rendered; it enters in the direction of travel (not at all under reduced motion). */
const StepBox = styled.div<{ $dir: 1 | -1 | 0 }>`
  display: grid;
  gap: var(--gap);
  min-width: 0;
  ${({ $dir }) =>
    $dir !== 0 &&
    css`
      animation: ${$dir > 0 ? slideFromRight : slideFromLeft} 240ms
        var(--ease-out);
    `}
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px 16px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--stroke);
  .why {
    flex: 1 1 220px;
    min-width: 0;
    order: -1;
    width: 100%;
    color: var(--err);
    font-size: var(--fs-sm);
  }
  button[data-testid="continue"] {
    margin-left: auto;
  }
  button {
    white-space: nowrap;
  }
`;

const Review = styled.dl`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) auto;
  gap: 8px 16px;
  align-items: center;
  margin: 0 0 16px;
  padding: 12px 16px;
  border: 1px solid var(--stroke);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  dt {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  dd {
    margin: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  button {
    white-space: nowrap;
  }
  @media (max-width: 480px) {
    grid-template-columns: minmax(0, 1fr) auto;
    dt {
      grid-column: 1 / -1;
      margin-bottom: -4px;
    }
  }
`;

const Choice = styled.div`
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding: 4px 0;
  label {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    line-height: 1;
  }
  input[type="radio"] {
    margin: 0;
  }
`;

const Summary = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px 16px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border: 1px solid var(--stroke);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  .names {
    display: inline-flex;
    gap: 6px 14px;
    flex-wrap: wrap;
    align-items: center;
    font-weight: 600;
  }
  .sw {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
`;

const OracleList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
    padding: 0 4px;
    border-bottom: 1px solid var(--stroke);
  }
  li:last-child {
    border-bottom: 0;
  }
  li > label {
    flex: 1;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-weight: 600;
  }
  .fee {
    font-variant-numeric: tabular-nums;
    font-family: var(--font-code);
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .off {
    color: var(--warn);
    font-size: var(--fs-sm);
  }
`;

const ListHead = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 0 4px 6px;
  color: var(--text-2);
  font-size: var(--fs-sm);
  border-bottom: 1px solid var(--stroke);
`;

const Threshold = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-top: 16px;
  margin-top: 8px;
  border-top: 1px solid var(--stroke);
  p {
    color: var(--text-2);
    font-size: var(--fs-sm);
    max-width: 46ch;
  }
`;

const Stepper = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  output {
    min-width: 9ch;
    text-align: center;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  button {
    padding: 8px 16px;
    min-height: 44px;
    min-width: 44px;
  }
`;

const PayGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: var(--gap-card) 48px;
  > div:last-child {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
`;

const Kv = styled.dl`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 16px;
  align-items: baseline;
  margin: 0;
  dt {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-code);
    font-size: var(--fs-sm);
  }
  .total {
    border-top: 1px solid var(--stroke);
    padding-top: 10px;
    font-weight: 600;
    color: var(--text);
  }
  dd.total {
    font-size: var(--fs-lg);
  }
`;

const Note = styled.p`
  font-size: var(--fs-sm);
  color: var(--text-2);
  margin-top: 10px;
`;

const TokenSteps = styled.ol`
  list-style: none;
  padding: 0;
  margin: 14px 0 0;
  display: grid;
  gap: 8px;
  font-size: var(--fs-sm);
  color: var(--text-2);
  li {
    display: flex;
    gap: 10px;
    align-items: center;
  }
`;

const StepN = styled.span<{ $done: boolean }>`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: var(--fs-sm);
  font-weight: 700;
  border: 1px solid
    ${({ $done }) => ($done ? "transparent" : "var(--stroke-strong)")};
  background: ${({ $done }) => ($done ? "var(--ok-bg)" : "transparent")};
  color: ${({ $done }) => ($done ? "var(--ok)" : "var(--text-2)")};
  svg {
    width: 14px;
    height: 14px;
  }
`;

const Actions = styled.div`
  display: grid;
  gap: 10px;
  margin-top: 18px;
  > button,
  > a {
    width: 100%;
  }
`;

const Result = styled.div`
  margin-top: 14px;
  &:empty {
    display: none;
  }
`;

const Hash = styled.span`
  font-family: var(--font-code);
  font-size: var(--fs-sm);
`;

const Sending = styled.p`
  font-size: var(--fs-sm);
  color: var(--text-2);
  padding: 10px 12px;
  border: 1px dashed var(--stroke-strong);
  border-radius: var(--r);
`;

function selectionMessage(err: SelectionError, oracles: Oracle[]): string {
  if (err.kind === "empty") return "Choose an oracle first.";
  if (err.kind === "threshold-too-high")
    return `You require ${err.threshold} oracles to agree, but only ${err.selected} ${err.selected === 1 ? "is" : "are"} selected. Select another oracle or lower the requirement.`;
  const name =
    oracles.find((o) => o.id === err.oracleId)?.name ??
    `Oracle ${err.oracleId}`;
  return `${name} is disabled on the gateway. Choose another oracle.`;
}

const thresholdText = (k: number, n: number) =>
  k > n ? `${k} required · ${n} selected` : `${k} of ${n} must agree`;

type Outcome = { ok: SwitchRequest } | { err: SendFailure } | null;

export const RequestPage: React.FC = () => {
  const { data } = useSetup();
  const route = useMemo(() => routeConfig(data.chains()), [data]);
  const names = { foreign: route.from.name, home: route.to.name };
  const wallet = useWallet();
  const location = useLocation();
  const [attempt, setAttempt] = useState(0);
  const [oracles, setOracles] = useState<Oracle[] | null>(null);
  const [defaults, setDefaults] = useState<OracleSelection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"default" | "custom">("default");
  const [customIds, setCustomIds] = useState<number[]>([]);
  const [customK, setCustomK] = useState(1);
  const [token, setToken] = useState<PayToken>("native");
  const [quote, setQuote] = useState<CostQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [bulbStored, setBulbStored] = useState<{
    owner: string;
    read: BulbRead;
  } | null>(null);
  const [bulbTick, setBulbTick] = useState(0);
  const [quoteTry, setQuoteTry] = useState(0);
  const [ackAgain, setAckAgain] = useState(false);
  const [busy, setBusy] = useState<"approve" | "send" | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [approveError, setApproveError] = useState<SendFailure | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reached, setReached] = useState<1 | 2 | 3>(1);
  const [dir, setDir] = useState<1 | -1 | 0>(0);
  const root = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef(false);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    Promise.all([data.oracles(), data.defaultSelection()])
      .then(([o, d]) => {
        if (!live) return;
        setOracles(o);
        setDefaults(d);
        setCustomIds(d.oracleIds);
        setCustomK(d.threshold);
      })
      .catch((e) => live && setLoadError(plainError(e)));
    return () => {
      live = false;
    };
  }, [data, attempt]);

  // The pill in the top bar links to #network-route: step 1 is shown, then the route is scrolled into view.
  useEffect(() => {
    if (location.hash !== "#network-route") return;
    pendingScroll.current = true;
    setDir(-1);
    setStep(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash, location.key]);
  useEffect(() => {
    if (pendingScroll.current && step === 1) {
      pendingScroll.current = false;
      document.getElementById("network-route")?.scrollIntoView();
    }
  });

  const ids = useMemo(
    () =>
      mode === "default"
        ? (defaults?.oracleIds ?? [])
        : [...customIds].sort((a, b) => a - b),
    [mode, defaults, customIds],
  );
  const k = mode === "default" ? (defaults?.threshold ?? 0) : customK;
  const idsKey = ids.join(",");
  const selection: OracleSelection | null =
    mode === "default" ? null : { oracleIds: ids, threshold: k };

  const selError: SelectionError | null = useMemo(() => {
    if (!oracles || mode === "default") return null;
    if (ids.length === 0) return { kind: "empty" };
    if (k > ids.length)
      return { kind: "threshold-too-high", threshold: k, selected: ids.length };
    try {
      return data.validateSelection({ oracleIds: ids, threshold: k }, oracles);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, oracles, mode, idsKey, k]);

  // A failure goes away when the configuration changes; a sent request keeps its confirmation.
  useEffect(() => {
    // an unknown outcome stays: the first request may already be on chain, so its warning outlives edits
    setOutcome((o) =>
      o && ("ok" in o || o.err.kind === "unknown") ? o : null,
    );
    setAckAgain(false);
  }, [mode, idsKey, k, token]);

  useEffect(() => {
    if (!oracles || !defaults || selError) return;
    let live = true;
    setQuoteError(null);
    data
      .quote(
        mode === "default" ? null : { oracleIds: ids, threshold: k },
        token,
      )
      .then((q) => live && setQuote(q))
      .catch((e) => live && setQuoteError(plainError(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, oracles, defaults, selError, mode, idsKey, k, token, quoteTry]);

  // In a threshold error each chosen oracle still shows its own fee (read for the corrected threshold); only the
  // total stays hidden. This quote is never actionable.
  const [feeQuote, setFeeQuote] = useState<CostQuote | null>(null);
  const thresholdTooHigh = selError?.kind === "threshold-too-high";
  useEffect(() => {
    setFeeQuote(null);
    if (!thresholdTooHigh || !oracles || ids.length === 0) return;
    let live = true;
    data.quote({ oracleIds: ids, threshold: ids.length }, token).then(
      (q) => live && setFeeQuote(q),
      () => {},
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, oracles, thresholdTooHigh, idsKey, token]);

  // Only a quote made for the configuration on screen is actionable.
  const current =
    !selError && quoteMatches(quote, { selection, token }) ? quote : null;
  const updating = !!oracles && !selError && !current && !quoteError;

  const refreshWalletReads = useCallback(() => {
    if (!wallet.ready || !wallet.address) {
      setAllowance(null);
      return;
    }
    const owner = wallet.address;
    data.usdcAllowance(owner).then(setAllowance, () => setAllowance(null));
  }, [data, wallet.ready, wallet.address]);
  useEffect(refreshWalletReads, [refreshWalletReads]);

  // The bulb read belongs to one account: a read for another account is cleared and obsolete responses are ignored.
  const bulbOwner =
    (wallet.ready || wallet.status === "wrong-chain") && wallet.address
      ? wallet.address
      : null;
  useEffect(() => {
    if (!bulbOwner) return;
    let live = true;
    const stop = readBulb(
      data,
      bulbOwner,
      () => live,
      (read) => setBulbStored({ owner: bulbOwner, read }),
    );
    return () => {
      live = false;
      stop();
    };
  }, [data, bulbOwner, bulbTick]);
  const bulbRead = resolveBulbRead(bulbStored, bulbOwner);

  const networkUp = !loadError;
  const gate = walletGate({
    networkUp,
    status: wallet.status,
    chainId: wallet.chainId,
    route,
  });
  const usdc = token === "usdc";
  const failure = outcome && "err" in outcome ? outcome.err : null;
  const submission = submissionActions(failure, ackAgain);
  const sentOk = !!outcome && "ok" in outcome;
  const frozen = !!busy || sentOk;
  const covered = !!current && allowance !== null && allowance >= current.total;
  const needsApproval = usdc && !!current && !covered && !sentOk;
  const canAct = gate.canTransact && !selError && !!current && !busy && !sentOk;
  const canSend = canAct && !needsApproval && submission.sendEnabled;
  const costState = costStatus({
    selError: !!selError,
    quoteError,
    updating,
    hadQuote: !!quote,
  });
  const oracleName = (id: number) =>
    oracles?.find((o) => o.id === id)?.name ?? `Oracle ${id}`;
  const breakdown = current ? costBreakdown(current, oracleName) : null;
  const total = breakdown?.total ?? null;

  const selectedNames = (oracles ?? [])
    .filter((o) => ids.includes(o.id))
    .map((o) => o.name);
  const summaryText =
    mode === "default"
      ? `Default selection · ${selectedNames.join(", ")} · ${k} must agree`
      : `Custom selection · ${selectedNames.join(", ")} · ${thresholdText(k, ids.length)}`;

  const approve = async () => {
    if (!current) return;
    setBusy("approve");
    setApproveError(null);
    setSubmitted(total);
    try {
      await data.approveUsdc(current.total);
      if (wallet.address)
        setAllowance(await data.usdcAllowance(wallet.address));
    } catch (e) {
      setApproveError(sendFailure(e, "approve"));
    } finally {
      setBusy(null);
      setSubmitted(null);
    }
  };

  const send = async () => {
    setBusy("send");
    setOutcome(null);
    setSubmitted(`${summaryText} · ${total ?? ""}`);
    try {
      const req = await data.requestSwitch(selection, token);
      setOutcome({ ok: req });
    } catch (e) {
      const f = sendFailure(e);
      setOutcome({ err: f });
      // the outcome is unknown: the submitted configuration stays visible beside "Check your requests"
      if (f.kind !== "unknown") setSubmitted(null);
    } finally {
      setBusy(null);
      refreshWalletReads();
      setBulbTick((t) => t + 1);
    }
  };

  const another = () => {
    setOutcome(null);
    setSubmitted(null);
    setApproveError(null);
    setAckAgain(false);
    setMode("default");
    setStep(1);
    setReached(1);
    setDir(-1);
    refreshWalletReads();
    setBulbTick((t) => t + 1);
  };

  const goTo = (n: 1 | 2 | 3) => {
    if (busy) return;
    setDir(n > step ? 1 : -1);
    setStep(n);
    setReached((r) => (n > r ? n : r));
  };
  const selectionOk = !!oracles && !!defaults && !selError;
  const canGo = (n: 1 | 2 | 3) =>
    !busy && (n <= step || (n <= reached && (n < 3 || selectionOk)));

  // Focus moves to the new step's heading on every step change (and to the confirmation once sent).
  const firstFocus = useRef(true);
  useEffect(() => {
    if (firstFocus.current) {
      firstFocus.current = false;
      return;
    }
    const el = root.current?.querySelector<HTMLElement>(
      '[data-step-heading], [data-testid="request-success"] h3',
    );
    if (!el) return;
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  }, [step, sentOk]);

  const toggleOracle = (id: number, on: boolean) =>
    setCustomIds((cur) =>
      on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id),
    );

  const customize = () => {
    if (defaults) {
      setCustomIds(defaults.oracleIds);
      setCustomK(defaults.threshold);
    }
    setMode("custom");
  };

  const model = useMemo(
    () => previewModel(oracles ?? [], ids, k, bulbRead, names),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [oracles, idsKey, k, bulbRead, route],
  );

  const feeBreakdown =
    breakdown ?? (feeQuote ? costBreakdown(feeQuote, oracleName) : null);
  const feeOf = (id: number) =>
    feeBreakdown?.lines.find((l) => l.oracleId === id)?.text ?? "–";
  const successTx =
    outcome && "ok" in outcome
      ? (outcome.ok.txs.find((x) => x.stage === "submitted") ??
        outcome.ok.txs[0])
      : null;

  const STEPS: { n: 1 | 2 | 3; label: string }[] = [
    { n: 1, label: "Network route" },
    { n: 2, label: "Choose oracles" },
    { n: 3, label: "Pay and send" },
  ];

  const continueReason =
    step === 2
      ? !oracles
        ? "Loading oracles…"
        : selError
          ? selectionMessage(selError, oracles)
          : null
      : null;

  const preview = (
    <Side>
      <Panel $tight aria-labelledby="circuit-h">
        <PanelHead $pad>
          <div>
            <h2 id="circuit-h">Route preview</h2>
            <p>Your choices on the route. Track shows a request's progress.</p>
          </div>
        </PanelHead>
        <Circuit
          model={model}
          names={names}
          label={`Route preview from your lightbulb on ${names.foreign} to Kleros Court on ${names.home} and back. Each coloured strand is an oracle; the circle shows how many must agree.`}
        />
      </Panel>
    </Side>
  );

  const usdcSteps = (
    <TokenSteps aria-label="Paying in USDC takes two transactions">
      <li data-testid="usdc-step-approve" data-done={sentOk || covered}>
        <StepN $done={sentOk || covered}>
          {sentOk || covered ? <Icon.check /> : "1"}
        </StepN>
        {sentOk || covered
          ? "USDC approved"
          : `Allow this app to spend ${total ?? "the request fee"}`}
      </li>
      <li data-testid="usdc-step-send" data-done={sentOk}>
        <StepN $done={sentOk}>{sentOk ? <Icon.check /> : "2"}</StepN>
        {sentOk ? "Request sent" : "Send the request"}
      </li>
    </TokenSteps>
  );

  const paymentNote = (
    <Disclosure summary="Payment details" data-testid="payment-details">
      <p>
        {usdc
          ? "Converted at the gateway's current USDC rate. The app spends exactly the request fee."
          : "Anything sent above the request fee is refunded in the same transaction."}
      </p>
    </Disclosure>
  );

  const errorCallout = (
    title: string,
    f: SendFailure,
    testId: string,
    summary?: boolean,
  ) => (
    <Callout tone="err" title={title} data-testid={testId}>
      <p>{f.message}</p>
      <p>{f.advice}</p>
      {summary && submitted && (
        <p data-testid="submitted-summary">Submitted: {submitted}</p>
      )}
      {f.detail && (
        <Disclosure summary="Technical details">
          <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{f.detail}</pre>
        </Disclosure>
      )}
    </Callout>
  );

  const stepOne = (
    <>
      <RouteSection
        gate={gate}
        unavailable={loadError}
        onRetry={() => setAttempt((a) => a + 1)}
      >
        <Footer>
          <LibButton
            type="button"
            text="Continue"
            onClick={() => goTo(2)}
            data-testid="continue"
          />
        </Footer>
      </RouteSection>
    </>
  );

  const stepTwo = (
    <Panel id="choose-oracles" aria-labelledby="oracles-h">
      <PanelHead>
        <div>
          <h2 id="oracles-h" data-step-heading>
            Choose oracles
          </h2>
          <p>
            Oracles are independent bridges. They carry the request to Kleros
            Court on {names.home} and bring the decision back. Both trips use
            the same oracles.
          </p>
        </div>
        {mode === "custom" && ids.length > 0 && (
          <LibButton
            small
            variant="secondary"
            text="Use default selection"
            type="button"
            onClick={() => setMode("default")}
            data-testid="use-default"
          />
        )}
      </PanelHead>

      {mode === "default" ? (
        <>
          <Summary data-testid="selection-summary">
            <span className="names">
              <span>{oracles ? summaryText : "Loading oracles…"}</span>
              {oracles &&
                ids.map((id) => (
                  <span key={id} className="sw" aria-hidden="true">
                    <Swatch $color={oracleColor(id)} />
                  </span>
                ))}
            </span>
            <LibButton
              variant="secondary"
              text="Customize selection"
              type="button"
              disabled={!oracles}
              onClick={customize}
              data-testid="customize"
            />
          </Summary>
          <Note>{AGREEMENT_HINT}</Note>
        </>
      ) : (
        <>
          <ListHead aria-hidden="true">
            <span>Oracle</span>
            <span>Fee ({token === "usdc" ? "USDC" : "ETH"})</span>
          </ListHead>
          <OracleList>
            {(oracles ?? []).map((o) => (
              <li key={o.id} data-testid={`oracle-row-${o.id}`}>
                <label>
                  <Checkbox
                    small
                    label={o.name}
                    checked={ids.includes(o.id)}
                    disabled={!o.enabled && !ids.includes(o.id)}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      toggleOracle(o.id, e.target.checked)
                    }
                  />
                </label>
                <Swatch $color={oracleColor(o.id)} />
                {!o.enabled && <span className="off">disabled</span>}
                <span className="fee">
                  {ids.includes(o.id) ? feeOf(o.id) : "–"}
                </span>
              </li>
            ))}
          </OracleList>
          {ids.length === 0 ? (
            <Threshold>
              <div>
                <h3>Choose an oracle first</h3>
                <p>
                  The agreement requirement appears once an oracle is chosen.
                </p>
              </div>
              <LibButton
                variant="secondary"
                text="Use default selection"
                type="button"
                onClick={() => setMode("default")}
                data-testid="use-default"
              />
            </Threshold>
          ) : (
            <Threshold>
              <div>
                <h3 id="threshold-h">Agreement needed</h3>
                <p>{AGREEMENT_HINT}</p>
              </div>
              <Stepper role="group" aria-labelledby="threshold-h">
                <LibButton
                  small
                  variant="secondary"
                  text="−"
                  type="button"
                  aria-label="Fewer oracles must agree"
                  disabled={k <= 1}
                  onClick={() => setCustomK((x) => Math.max(1, x - 1))}
                />
                <output aria-live="polite" data-testid="threshold">
                  {thresholdText(k, ids.length)}
                </output>
                <LibButton
                  small
                  variant="secondary"
                  text="+"
                  type="button"
                  aria-label="More oracles must agree"
                  disabled={k >= ids.length}
                  onClick={() => setCustomK((x) => Math.min(ids.length, x + 1))}
                />
              </Stepper>
            </Threshold>
          )}
        </>
      )}
      {selError && oracles && (
        <FieldError role="alert" data-testid="selection-error">
          <Icon.alert />
          <span>{selectionMessage(selError, oracles)}</span>
        </FieldError>
      )}
      <Footer>
        {continueReason && (
          <p className="why" id="continue-reason" data-testid="continue-reason">
            Continue is unavailable: {continueReason}
          </p>
        )}
        <LibButton
          variant="secondary"
          type="button"
          text="Back"
          onClick={() => goTo(1)}
          data-testid="back"
        />
        <LibButton
          type="button"
          text="Continue"
          disabled={!selectionOk}
          aria-describedby={continueReason ? "continue-reason" : undefined}
          onClick={() => goTo(3)}
          data-testid="continue"
        />
      </Footer>
    </Panel>
  );

  const stepThree = (
    <Panel id="pay-and-send" aria-labelledby="pay-h">
      <PanelHead>
        <div>
          <h2 id="pay-h" data-step-heading>
            Pay and send
          </h2>
          <p>
            Check your choices, then pay once, here on {names.foreign}. Nothing
            to pay on {names.home}.
          </p>
        </div>
      </PanelHead>

      <Review data-testid="review">
        <dt>Route</dt>
        <dd data-testid="review-route">
          {names.foreign} → {names.home} · Local devnet
        </dd>
        <LibButton
          small
          variant="secondary"
          type="button"
          text="Edit"
          aria-label="Edit network route"
          disabled={!!busy}
          onClick={() => goTo(1)}
          data-testid="edit-route"
        />
        <dt>Oracles</dt>
        <dd data-testid="review-selection">{summaryText}</dd>
        <LibButton
          small
          variant="secondary"
          type="button"
          text="Edit"
          aria-label="Edit oracle selection"
          disabled={!!busy}
          onClick={() => goTo(2)}
          data-testid="edit-oracles"
        />
      </Review>

      {gate.state !== "ready" && (
        <div style={{ marginBottom: 16 }}>
          {loadError ? (
            <NetworkDown
              error={loadError}
              onRetry={() => setAttempt((a) => a + 1)}
            />
          ) : (
            <WalletStrip gate={gate} />
          )}
        </div>
      )}

      <Choice role="radiogroup" aria-label="Pay with">
        <Radio
          small
          name="pay"
          label="ETH"
          value="native"
          checked={token === "native"}
          disabled={frozen}
          onChange={() => setToken("native")}
        />
        <Radio
          small
          name="pay"
          label="USDC"
          value="usdc"
          checked={token === "usdc"}
          disabled={frozen}
          onChange={() => setToken("usdc")}
        />
      </Choice>

      <PayGrid>
        <div>
          {current && breakdown ? (
            <>
              <p
                className="sub"
                style={{ fontSize: "var(--fs-sm)", marginBottom: 8 }}
              >
                Amounts in {breakdown.symbol}
              </p>
              <Kv data-testid="cost">
                <dt>Juror fees</dt>
                <dd data-testid="cost-jurors">{breakdown.lines[0].text}</dd>
                {breakdown.lines.slice(1).map((l) => (
                  <React.Fragment key={l.key}>
                    <dt>
                      <span
                        style={{
                          display: "inline-flex",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        {l.oracleId !== undefined && (
                          <Swatch $color={oracleColor(l.oracleId)} />
                        )}
                        {l.label}
                      </span>
                    </dt>
                    <dd
                      data-testid={
                        l.oracleId !== undefined
                          ? `cost-oracle-${l.oracleId}`
                          : `cost-${l.key}`
                      }
                    >
                      {l.text}
                    </dd>
                  </React.Fragment>
                ))}
                <dt className="total">Request fee</dt>
                <dd className="total" data-testid="cost-total">
                  {breakdown.total}
                </dd>
              </Kv>
              <Note>Network gas extra, paid in local ETH</Note>
              {paymentNote}
            </>
          ) : (
            <>
              <p
                className="sub"
                style={{ fontSize: "var(--fs-sm)" }}
                role="status"
                data-testid="cost-status"
              >
                {costState.text}
              </p>
              {costState.retry && (
                <p style={{ marginTop: 8 }}>
                  <LibButton
                    small
                    variant="secondary"
                    text="Retry fee calculation"
                    type="button"
                    onClick={() => setQuoteTry((t) => t + 1)}
                    data-testid="retry-quote"
                  />
                </p>
              )}
            </>
          )}
        </div>

        <div>
          {usdc && usdcSteps}

          {busy && submitted && (
            <Sending
              role="status"
              data-testid="submitted-summary"
              style={{ marginTop: 14 }}
            >
              {busy === "approve" ? "Approving" : "Sending"}: {submitted}.
              Waiting for confirmation…
            </Sending>
          )}

          <Actions>
            {!gate.canTransact && (
              <p
                data-testid="pay-gate"
                style={{ fontSize: "var(--fs-sm)" }}
                className="sub"
                role="status"
              >
                {gate.message}
              </p>
            )}
            {gate.state === "wrong-chain" && (
              <LibButton
                variant="secondary"
                type="button"
                text={`Switch to ${route.fromLabel}`}
                disabled={wallet.busy}
                onClick={() => void wallet.switchToForeign()}
                data-testid="switch-chain-pay"
              />
            )}
            {usdc && (needsApproval || !current) && (
              <LibButton
                variant="secondary"
                type="button"
                text={
                  busy === "approve"
                    ? "Waiting for confirmation…"
                    : `Approve ${total ?? "USDC"}`
                }
                disabled={!canAct}
                isLoading={busy === "approve"}
                onClick={() => void approve()}
                data-testid="approve"
              />
            )}
            {submission.primary === "check" && (
              <ButtonLink $primary to="/track" data-testid="check-requests">
                Check your requests
              </ButtonLink>
            )}
            {submission.showSendAgain && (
              <Checkbox
                small
                label="I checked Track and want to send again"
                checked={ackAgain}
                disabled={!!busy}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setAckAgain(e.target.checked)
                }
                data-testid="ack-again"
              />
            )}
            <LibButton
              type="button"
              variant={submission.showSendAgain ? "secondary" : undefined}
              text={
                busy === "send"
                  ? "Waiting for confirmation…"
                  : submission.showSendAgain
                    ? "Send again…"
                    : `Send request${total ? ` · ${total}` : ""}`
              }
              disabled={!canSend}
              isLoading={busy === "send"}
              onClick={() => void send()}
              data-testid="send"
            />
          </Actions>
          {approveError && (
            <Result>
              {errorCallout(approveError.title, approveError, "approve-error")}
            </Result>
          )}
          <Result aria-live="polite">
            {failure &&
              errorCallout(
                failure.title,
                failure,
                "request-error",
                failure.kind === "unknown",
              )}
          </Result>
        </div>
      </PayGrid>
      <Footer>
        <LibButton
          variant="secondary"
          type="button"
          text="Back"
          disabled={!!busy}
          onClick={() => goTo(2)}
          data-testid="back"
        />
      </Footer>
    </Panel>
  );

  const done = outcome && "ok" in outcome ? outcome.ok : null;

  return (
    <Shell>
      <PageHead>
        <div>
          <h1>Ask Kleros to switch your lightbulb</h1>
          <p>{REQUEST_INTRO}</p>
        </div>
      </PageHead>

      {loadError && (
        <span className="visually-hidden">The gateway could not be read.</span>
      )}

      <div ref={root}>
        {done ? (
          <Panel aria-label="Request sent" data-testid="completion">
            <Callout
              tone="ok"
              title={`Request #${done.disputeId} sent`}
              data-testid="request-success"
            >
              <div
                className="sub"
                style={{ fontSize: "var(--fs-sm)", overflowWrap: "anywhere" }}
              >
                {successTx && (
                  <>
                    Transaction{" "}
                    <Copiable
                      copiableContent={successTx.hash}
                      info="Copy transaction hash"
                    >
                      <Hash title={successTx.hash} data-testid="request-tx">
                        {shortHash(successTx.hash)}
                      </Hash>
                    </Copiable>{" "}
                    confirmed.{" "}
                  </>
                )}
                Open Track to follow this request.
              </div>
              {submitted && (
                <p
                  className="sub"
                  style={{ fontSize: "var(--fs-sm)", marginTop: 6 }}
                  data-testid="submitted-summary"
                >
                  {submitted}
                </p>
              )}
              {usdc && usdcSteps}
              {paymentNote}
              <p
                style={{
                  marginTop: 10,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <ButtonLink $primary to={`/track/${done.disputeId}`}>
                  Track request
                </ButtonLink>
                <LibButton
                  variant="secondary"
                  text="Start a new request"
                  type="button"
                  onClick={another}
                  data-testid="new-request"
                />
              </p>
            </Callout>
          </Panel>
        ) : (
          <Layout>
            <Main
              onSubmit={(e) => e.preventDefault()}
              noValidate
              aria-label="Request a switch"
            >
              <Progress aria-label="Request steps" data-testid="steps">
                <p className="count" data-testid="step-count">
                  Step {step} of 3
                </p>
                <ol>
                  {STEPS.map(({ n, label }) => (
                    <li key={n}>
                      <button
                        type="button"
                        className={n < step ? "done" : undefined}
                        aria-current={n === step ? "step" : undefined}
                        aria-label={`Step ${n}: ${label}`}
                        disabled={!canGo(n)}
                        onClick={() => goTo(n)}
                        data-testid={`marker-${n}`}
                      >
                        <span className="n" data-n={n} aria-hidden="true">
                          {n < step && <Icon.check />}
                        </span>
                        <span>{label}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </Progress>
              <StepBox key={step} $dir={dir} data-testid={`step-${step}`}>
                {step === 1 ? stepOne : step === 2 ? stepTwo : stepThree}
              </StepBox>
            </Main>
            {preview}
          </Layout>
        )}
      </div>
    </Shell>
  );
};
