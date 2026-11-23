import React, { useState } from "react";
import { Field } from "@kleros/ui-components-library";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { LibButton } from "./ui";

/** The find form's box: the field and its button in one row, the lists and messages below. */
export const Picker = styled.div`
  display: grid;
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
  form > button {
    min-height: 44px;
  }
  .msg {
    font-size: var(--fs-sm);
    color: var(--text-2);
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

/**
 * Look up a request by its number, or by the Kleros court case it opened (what jurors know), with a persistent label
 * and inline validation. A request opens its Track page; a court case goes through /case/<number>, which finds its
 * request.
 */
export const OpenById: React.FC<{ onGo?: () => void; initialKind?: FindKind }> = ({ onGo, initialKind = "request" }) => {
  const nav = useNavigate();
  const [kind, setKind] = useState<FindKind>(initialKind);
  const [v, setV] = useState("");
  const value = v.trim();
  const invalid = value !== "" && !/^\d+$/.test(value);
  const isCase = kind === "case";
  return (
    <div>
      <Kind>
        <legend className="lbl">Find by</legend>
        <label>
          <input
            type="radio"
            name="find-kind"
            value="request"
            checked={!isCase}
            onChange={() => setKind("request")}
            data-testid="find-kind-request"
          />
          Request
        </label>
        <label>
          <input
            type="radio"
            name="find-kind"
            value="case"
            checked={isCase}
            onChange={() => setKind("case")}
            data-testid="find-kind-case"
          />
          Court case
        </label>
      </Kind>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value && !invalid) {
            nav(isCase ? `/case/${value}` : `/track/${value}`);
            onGo?.();
          }
        }}
        noValidate
      >
        <div style={{ flex: 1 }}>
          <label htmlFor="open-id" className="lbl">
            {isCase ? "Court case ID" : "Request ID"}
          </label>
          <Field
            id="open-id"
            placeholder={isCase ? "For example 214" : "For example 1"}
            inputMode="numeric"
            value={v}
            variant={invalid ? "error" : undefined}
            message={invalid ? `Use digits only, for example ${isCase ? "214" : "1"}.` : undefined}
            onChange={(e) => setV(e.target.value)}
          />
        </div>
        <LibButton variant="secondary" text="Open" type="submit" disabled={!value || invalid} style={{ marginTop: 24 }} />
      </form>
    </div>
  );
};
