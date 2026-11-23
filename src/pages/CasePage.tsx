// /case/<number>: a Kleros court case number, as jurors know it, resolved to the request that opened it; the page then
// hands over to that request's Track page. /case alone asks for the number.
import React, { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { OpenById, Picker } from "../components/FindById";
import { Loader } from "../components/Loader";
import { lookupCase, parseCaseNumber, type CaseLookup } from "../components/readState";
import { routeConfig } from "../components/route";
import { useSetup } from "../components/setup";
import { Callout, LibButton, PageHead, Panel, Shell } from "../components/ui";

/** The lookup's loading state, about the height of what replaces it. */
const Finding = styled(Panel)`
  display: flex;
  align-items: center;
  min-height: 120px;
  color: var(--text-2);
`;

const Resolve: React.FC<{ caseId: bigint }> = ({ caseId }) => {
  const { data } = useSetup();
  const home = routeConfig(data.chains()).to.name;
  const [lookup, setLookup] = useState<CaseLookup>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true;
    setLookup({ kind: "loading" });
    void lookupCase(data, caseId).then((r) => live && setLookup(r));
    return () => {
      live = false;
    };
  }, [data, caseId, attempt]);
  // The loader's status goes away with the answer: move focus to the new title so a screen reader says it (a failed
  // read is an alert of its own).
  useEffect(() => {
    if (lookup.kind === "missing") title.current?.focus();
  }, [lookup.kind]);

  const id = caseId.toString();
  if (lookup.kind === "found") return <Navigate to={`/track/${lookup.requestId.toString()}`} replace />;
  return (
    <Shell>
      <PageHead>
        <div>
          <h1 data-testid="case-title" ref={title} tabIndex={-1}>
            {lookup.kind === "missing" ? `No request for court case #${id}` : `Court case #${id}`}
          </h1>
          <p>Kleros Court on {home}.</p>
        </div>
      </PageHead>
      {lookup.kind === "loading" ? (
        <Finding data-testid="case-loading">
          <Loader label={`Finding the request of court case #${id}…`} />
        </Finding>
      ) : lookup.kind === "error" ? (
        <Callout tone="err" title={`Could not look up court case #${id}`} data-testid="case-error">
          <p>{lookup.message}</p>
          <p style={{ marginTop: 8 }}>
            <LibButton
              small
              variant="secondary"
              text="Retry"
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              data-testid="case-retry"
            />
          </p>
        </Callout>
      ) : (
        <Panel data-testid="case-missing">
          <p className="sub" style={{ overflowWrap: "anywhere" }}>
            Court case #{id} was not opened by a lightbulb request on this site. Check the number Kleros Court shows, or
            look the request up by its own number.
          </p>
          <div style={{ marginTop: 16 }}>
            <Picker>
              <OpenById initialKind="case" />
            </Picker>
          </div>
        </Panel>
      )}
    </Shell>
  );
};

export const CasePage: React.FC = () => {
  const { caseId } = useParams();
  // whole digits within uint256 (the court's dispute IDs); anything else is not a court case number
  const parsed = caseId !== undefined ? parseCaseNumber(caseId) : null;
  if (parsed !== null) return <Resolve key={caseId} caseId={parsed} />;
  const given = caseId !== undefined && caseId !== "";
  return (
    <Shell>
      <PageHead>
        <div>
          <h1 data-testid="case-title">{given ? "Not a court case number" : "Find a court case"}</h1>
          <p>
            {given
              ? "Court case numbers are whole numbers, as Kleros Court shows them."
              : "Enter the Kleros Court case number to open the request it decides."}
          </p>
        </div>
      </PageHead>
      <Panel>
        <Picker>
          <OpenById initialKind="case" />
        </Picker>
      </Panel>
    </Shell>
  );
};
