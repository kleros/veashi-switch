import React, { useEffect, useId, useRef, useState } from "react";
import { Field } from "@kleros/ui-components-library";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { parseCaseNumber } from "./readState";
import { lookupCaseAcrossRoutes, routeSource, trackPath } from "./routing";
import { useSetup } from "./setup";
import { LibButton } from "./ui";

/** The find form's box: the field and its button in one row (stacked on narrow screens), the lists and messages below. */
export const Picker = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr); /* the box's width bounds the field (an input has a default width of its own) */
  gap: 10px;
  min-width: min(100%, 300px);
  max-width: 480px;
  form > div:first-child > div,
  form input {
    width: 100%;
  }
  .lbl {
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  form {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  form > div:first-child {
    flex: 1;
    min-width: 0;
  }
  form > button {
    min-height: 44px;
    margin-top: 24px; /* level with the field, below its label */
  }
  .msg {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  /* the field's own message, in the flow (not over what follows) and tied to the field */
  .field-msg {
    margin-top: 6px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  .field-msg.err {
    color: var(--err);
  }
  .field-msg:empty {
    margin: 0;
  }
  @media (max-width: 400px) {
    form {
      flex-wrap: wrap;
    }
    form > div:first-child {
      flex: 1 1 100%;
    }
    form > button {
      margin-top: 0;
      width: 100%;
    }
  }
`;

/** Request or court case: a radio pair above the field. */
const Kind = styled.fieldset`
  border: 0;
  margin: 0 0 4px;
  padding: 0;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 20px;
  legend {
    padding: 0;
    margin-bottom: 2px;
  }
  label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    white-space: nowrap;
    cursor: pointer;
  }
  input {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--purple-2);
    cursor: pointer;
  }
`;

export type FindKind = "request" | "case";

/** A court case number being looked up from the form, or what the lookup found when it was not a request. */
type CaseState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "missing"; id: string }
  | { kind: "error"; id: string; message: string };

/**
 * Look up a request by its number, or by the Kleros court case it opened (what jurors know), with a persistent label
 * and inline validation. A request opens its Track page. A court case is looked up here, so the page (and the dialog
 * that holds the form) stays put until its request is known: then its Track page opens; a case that is no request's,
 * or a failed read, is said under the field. `/case/<number>` does the same lookup for a link. With several routes, a
 * request ID is looked up on the network chosen beside it (IDs are per route), a court case number on all of them.
 */
export const OpenById: React.FC<{ onGo?: () => void; initialKind?: FindKind }> = ({ onGo, initialKind = "request" }) => {
  const nav = useNavigate();
  const { routes, route, neutral } = useSetup();
  const group = useId();
  const [kind, setKind] = useState<FindKind>(initialKind);
  // the networks a request ID can be opened on: the set-up routes, starting on the page's own
  const networks = routes.length > 1 ? routes.filter((r) => r.missing.length === 0) : [];
  const [networkId, setNetworkId] = useState(() => (!neutral && networks.some((r) => r.id === route.id) ? route.id : (networks[0]?.id ?? route.id)));
  const network = routes.find((r) => r.id === networkId) ?? route;
  const [v, setV] = useState("");
  const [lookup, setLookup] = useState<CaseState>({ kind: "idle" });
  // the latest lookup: a newer one, an edit or leaving the page makes an older answer obsolete
  const seq = useRef(0);
  useEffect(
    () => () => {
      seq.current++;
    },
    []
  );
  const value = v.trim();
  const invalid = value !== "" && !/^\d+$/.test(value);
  const isCase = kind === "case";
  const busy = lookup.kind === "busy";
  const reset = () => {
    seq.current++;
    setLookup({ kind: "idle" });
  };
  const example = isCase ? "214" : "1";
  const message = invalid
    ? { text: `Use digits only, for example ${example}.`, err: true }
    : lookup.kind === "missing"
      ? { text: `No request for court case #${lookup.id}. Check the number Kleros Court shows as Case #.`, err: true }
      : lookup.kind === "error"
        ? { text: `Could not look up court case #${lookup.id}. ${lookup.message} Use Open to try again.`, err: true }
        : null;
  const msgId = `${group}-msg`;

  const openCase = async () => {
    const n = ++seq.current;
    const caseId = parseCaseNumber(value);
    if (caseId === null) {
      setLookup({ kind: "missing", id: value });
      return;
    }
    setLookup({ kind: "busy" });
    const r = await lookupCaseAcrossRoutes(routes.map(routeSource), caseId);
    if (n !== seq.current) return;
    if (r.kind === "found") {
      setLookup({ kind: "idle" });
      nav(trackPath(routes.find((x) => x.id === r.routeId) ?? route, r.requestId));
      onGo?.();
    } else if (r.kind === "missing") setLookup({ kind: "missing", id: caseId.toString() });
    else if (r.kind === "error") setLookup({ kind: "error", id: caseId.toString(), message: r.message });
  };

  return (
    <div>
      <Kind>
        <legend className="lbl">Find by</legend>
        <label>
          <input
            type="radio"
            name={`${group}-kind`}
            value="request"
            checked={!isCase}
            onChange={() => {
              setKind("request");
              reset();
            }}
            data-testid="find-kind-request"
          />
          Request ID
        </label>
        <label>
          <input
            type="radio"
            name={`${group}-kind`}
            value="case"
            checked={isCase}
            onChange={() => {
              setKind("case");
              reset();
            }}
            data-testid="find-kind-case"
          />
          Court case number
        </label>
      </Kind>
      {!isCase && networks.length > 1 && (
        <Kind>
          <legend className="lbl">Network</legend>
          {networks.map((r) => (
            <label key={r.id}>
              <input
                type="radio"
                name={`${group}-network`}
                value={r.id}
                checked={network.id === r.id}
                onChange={() => setNetworkId(r.id)}
                data-testid={`find-network-${r.id}`}
              />
              {r.env.foreign.name}
            </label>
          ))}
        </Kind>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value || invalid || busy) return;
          if (isCase) void openCase();
          else {
            nav(trackPath(network, value));
            onGo?.();
          }
        }}
        noValidate
        aria-busy={busy}
      >
        <div>
          <label htmlFor="open-id" className="lbl">
            {isCase ? "Court case number" : "Request ID"}
          </label>
          <Field
            id="open-id"
            placeholder={`For example ${example}`}
            inputMode="numeric"
            value={v}
            variant={message?.err && lookup.kind !== "error" ? "error" : undefined}
            aria-invalid={invalid || lookup.kind === "missing" ? true : undefined}
            aria-describedby={message ? msgId : undefined}
            onChange={(e) => {
              setV(e.target.value);
              reset();
            }}
          />
          {/* always in the page, so a screen reader announces what appears in it */}
          <p id={msgId} className={`field-msg${message?.err ? " err" : ""}`} role="status" data-testid="find-msg">
            {message?.text}
          </p>
        </div>
        <LibButton
          variant="secondary"
          text={busy ? "Opening…" : "Open"}
          type="submit"
          disabled={!value || invalid || busy}
          isLoading={busy}
          data-testid="find-open"
        />
      </form>
    </div>
  );
};
