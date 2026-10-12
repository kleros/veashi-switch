import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import styled from "styled-components";

const Box = styled.div<{ $show: boolean }>`
  position: fixed;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%) translateY(${({ $show }) => ($show ? "0" : "20px")});
  opacity: ${({ $show }) => ($show ? 1 : 0)};
  pointer-events: none;
  background: var(--surface-2);
  border: 1px solid var(--stroke-strong);
  color: var(--text);
  padding: 10px 16px;
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  font-size: var(--fs-sm);
  transition:
    opacity 0.3s var(--ease-out),
    transform 0.3s var(--ease-out);
  z-index: 30;
  max-width: calc(100% - 32px);
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const ToastContext = createContext<(msg: string) => void>(() => {});

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((m: string) => {
    setMsg(m);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2600);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <Box role="status" aria-live="polite" $show={show}>
        {msg}
      </Box>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);

/** Copies text and says so; falls back to a hint when the clipboard is unavailable (e.g. plain http). */
export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (text: string, what = "Copied") => {
      try {
        await navigator.clipboard.writeText(text);
        toast(what);
      } catch {
        toast("Copy is unavailable here. Select the hash to copy it.");
      }
    },
    [toast],
  );
}
