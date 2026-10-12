import React, { useEffect, useRef } from "react";
import styled from "styled-components";
import { HELP_NOTE, HELP_STAGES, HELP_TERMS } from "./copy";
import { Icon, IconButton } from "./ui";

const Dialog = styled.dialog`
  border: 1px solid var(--stroke-strong);
  border-radius: var(--r-lg);
  background: var(--surface);
  color: var(--text);
  padding: 0;
  width: min(560px, calc(100% - 32px));
  max-height: calc(100dvh - 32px);
  box-shadow: var(--shadow);
  &::backdrop {
    background: var(--backdrop);
  }
`;

const In = styled.div`
  padding: 24px;
  display: grid;
  gap: 16px;
  @media (max-width: 640px) {
    padding: 18px;
  }
`;

const Top = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
`;

const Steps = styled.ol`
  margin: 0;
  padding-left: 1.3rem;
  display: grid;
  gap: 10px;
  color: var(--text-2);
  b {
    color: var(--text);
    font-weight: 600;
  }
`;

const Terms = styled.dl`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 16px;
  margin: 0;
  font-size: var(--fs-sm);
  dt {
    font-weight: 600;
  }
  dd {
    margin: 0;
    color: var(--text-2);
  }
  @media (max-width: 420px) {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    dd {
      margin-bottom: 8px;
    }
  }
`;

const Note = styled.p`
  font-size: var(--fs-sm);
  color: var(--text-2);
`;

/**
 * "How it works": a native modal dialog (the library has no modal). Escape closes it natively; on close the focus
 * goes back to whatever opened it.
 */
export const HelpDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  names?: { foreign: string; home: string };
}> = ({ open, onClose }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onDialogClose = () => {
      onClose();
      const o = opener.current;
      opener.current = null;
      if (o && o.isConnected) o.focus();
    };
    d.addEventListener("close", onDialogClose);
    return () => d.removeEventListener("close", onDialogClose);
  }, [onClose]);
  return (
    <Dialog
      ref={ref}
      aria-labelledby="help-h"
      data-testid="help-dialog"
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <In>
        <Top>
          <h2 id="help-h">How a switch request works</h2>
          <IconButton type="button" aria-label="Close" onClick={() => ref.current?.close()}>
            <Icon.close />
          </IconButton>
        </Top>
        <Steps data-testid="help-stages">
          {HELP_STAGES.map((st) => (
            <li key={st.lead}>
              <b>{st.lead}</b> {st.rest}
            </li>
          ))}
        </Steps>
        <h3>Words on these pages</h3>
        <Terms data-testid="help-terms">
          {HELP_TERMS.map((t) => (
            <React.Fragment key={t.term}>
              <dt>{t.term}</dt>
              <dd>{t.text}</dd>
            </React.Fragment>
          ))}
        </Terms>
        <Note>{HELP_NOTE}</Note>
      </In>
    </Dialog>
  );
};
