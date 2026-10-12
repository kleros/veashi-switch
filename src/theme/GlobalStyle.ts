import { createGlobalStyle } from "styled-components";
import { cssVars } from "./tokens";

export const GlobalStyle = createGlobalStyle`
  :root {
    ${({ theme }) => cssVars(theme)}
    --font-ui: "Open Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --font-code: "Fira Code", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    --fs-xs: 0.875rem;
    --fs-sm: 0.875rem;
    --fs-md: 0.9375rem;
    --fs-lg: 1.125rem;
    --fs-xl: 1.5rem;
    --r: 3px;
    --r-lg: 6px;
    --gap: 16px;
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; background: var(--ground); color: var(--text); }
  body {
    font-family: var(--font-ui);
    font-size: var(--fs-md);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  ::selection { background: var(--purple); color: var(--on-accent); }
  a { color: var(--blue); text-underline-offset: 3px; }
  code, .mono { font-family: var(--font-code); font-size: 0.92em; font-variant-ligatures: none; }
  .num { font-variant-numeric: tabular-nums; }
  :focus-visible { outline: 2px solid var(--purple-2); outline-offset: 2px; border-radius: var(--r); }
  * { scrollbar-color: var(--stroke-strong) transparent; scrollbar-width: thin; }
  h1, h2, h3 { text-wrap: balance; margin: 0; font-weight: 600; line-height: 1.25; }
  h1 { font-size: var(--fs-xl); }
  h2 { font-size: var(--fs-lg); }
  h3 { font-size: var(--fs-md); }
  p { margin: 0; }
  .muted { color: var(--text-3); }
  .sub { color: var(--text-2); }
  .visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  button:disabled, button[disabled], [aria-disabled="true"] { outline: 1px dashed var(--stroke-strong); outline-offset: -1px; }
  @media (max-width: 640px) {
    button, summary { min-height: 44px; }
    button { min-width: 44px; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  }
`;
