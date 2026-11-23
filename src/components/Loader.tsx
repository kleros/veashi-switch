import React from "react";
import styled, { keyframes } from "styled-components";

// The app's loading state: a signal dot runs along a short strand into a small bulb, which glows as it arrives (the
// circuit's travelling pulse and the bulb's filament, in miniature). Only transform and opacity move, on HTML
// elements, so the browser can run it off the main thread while the page is busy. index.html draws the same mark,
// in plain HTML and CSS, until the app mounts (the boot loader): keep the two in step.
//
// Geometry is in em of the mark's own font size, so one size prop scales the whole mark.

/**
 * The motion, shared word for word with the boot loader in index.html (Loader.test.ts checks the two are equal).
 * - travel: the dot runs the strand at one speed and slides under the glass edge as it fades (it never parks).
 * - glow: the lit bulb fades in as the dot arrives and out quickly, so the yellow-over-purple mix stays brief.
 * - enter: the mark fades in after a short delay, so a state that ends within it (a quick re-quote) shows only its
 *   label, as plain text did; the label itself shows at once.
 */
export const LOADER_MOTION = {
  travel: "0% { transform: translateX(0); opacity: 0; } 12% { opacity: 1; } 55% { opacity: 1; } 64%, 100% { transform: translateX(1.45em); opacity: 0; }",
  glow: "0%, 50% { opacity: 0; } 64% { opacity: 1; } 80%, 100% { opacity: 0; }",
  enter: "from { opacity: 0; } to { opacity: 1; }",
  /** One cycle, shared by the dot and the glow so the bulb lights as the dot arrives: the circuit pulse's 1.6s. */
  cycle: "1.6s",
  enterDuration: "200ms",
  enterDelay: "150ms",
} as const;

const travel = keyframes`${LOADER_MOTION.travel}`;
const glow = keyframes`${LOADER_MOTION.glow}`;
const enter = keyframes`${LOADER_MOTION.enter}`;
const CYCLE = LOADER_MOTION.cycle;

/**
 * Inline, in the text it replaces: the label keeps the surrounding font and colour. Aligned to the line's top, the
 * box is as tall as the label's own line (the mark is shorter), so the line does not grow; in a box too narrow for
 * both, the label wraps under the mark as whole words.
 */
const Root = styled.span<{ $size: "sm" | "lg" }>`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px ${({ $size }) => ($size === "lg" ? "14px" : "10px")};
  max-width: 100%;
  vertical-align: top;
  .mark {
    position: relative;
    flex: none;
    width: 2.75em;
    height: 1.25em;
    font-size: ${({ $size }) => ($size === "lg" ? "28px" : "16px")};
    animation: ${enter} ${LOADER_MOTION.enterDuration} var(--ease-out) ${LOADER_MOTION.enterDelay} both;
  }
  .strand {
    position: absolute;
    left: 0;
    top: 50%;
    width: 1.8em; /* runs under the glass edge */
    height: 2px;
    margin-top: -1px;
    border-radius: 1px;
    background: var(--stroke-strong);
  }
  .dot {
    position: absolute;
    left: 0.0625em;
    top: 50%;
    width: 0.375em;
    height: 0.375em;
    margin-top: -0.1875em;
    border-radius: 50%;
    background: var(--purple-2);
    animation: ${travel} ${CYCLE} linear infinite;
  }
  .bulb,
  .lit {
    position: absolute;
    right: 0;
    top: 0;
    width: 1.125em;
    height: 1.25em;
  }
  .bulb svg,
  .lit svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .lit {
    opacity: 0;
    animation: ${glow} ${CYCLE} ease-in-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    /* no movement: the dot rests on the strand in the "in progress" colour; the label says the rest */
    .mark {
      animation: none;
    }
    .dot {
      animation: none;
      transform: translateX(0.625em);
    }
    .lit {
      animation: none;
    }
  }
`;

// The bulb in an 18 × 20 box: glass, filament and screw, drawn like Bulb.tsx at a small size.
const GLASS = "M9 1.2a6.8 6.8 0 0 0-3.9 12.4c.5.4.9 1 .9 1.6v.6h6v-.6c0-.6.4-1.2.9-1.6A6.8 6.8 0 0 0 9 1.2z";
const FILAMENT = "M7.2 12.6V10l.9-2 .9 1.6.9-1.6.9 2v2.6";

const BulbMark: React.FC<{ lit?: boolean }> = ({ lit }) => (
  <svg viewBox="0 0 18 20" fill="none" strokeLinecap="round" strokeLinejoin="round">
    {lit && <circle cx="9" cy="8" r="8.6" fill="var(--bulb-halo)" />}
    <path d={GLASS} fill={lit ? "var(--bulb-on)" : "var(--bulb-glass)"} stroke={lit ? "var(--bulb-on)" : "var(--text-3)"} strokeWidth="1.4" />
    <path d={FILAMENT} stroke={lit ? "var(--bulb-filament-on)" : "var(--text-3)"} strokeWidth="1.1" />
    {!lit && (
      <>
        <rect x="5.8" y="16.6" width="6.4" height="1.4" rx="0.7" fill="var(--text-3)" />
        <rect x="6.8" y="18.6" width="4.4" height="1.2" rx="0.6" fill="var(--text-3)" opacity="0.7" />
      </>
    )}
  </svg>
);

/**
 * A loading state: the mark and its label, side by side. By default it is a polite live region (role="status"), so
 * the label is announced; pass `live={false}` when it sits inside a region that already announces (a status line, a
 * panel with aria-live). The mark is decorative: the label is the only text.
 */
export const Loader: React.FC<{
  label: string;
  size?: "sm" | "lg";
  live?: boolean;
  className?: string;
  "data-testid"?: string;
}> = ({ label, size = "sm", live = true, className, "data-testid": testId }) => (
  <Root
    $size={size}
    className={className}
    data-testid={testId}
    data-loader=""
    {...(live ? { role: "status", "aria-live": "polite" as const } : {})}
  >
    <span className="mark" aria-hidden="true">
      <span className="strand" />
      <span className="dot" />
      <span className="bulb">
        <BulbMark />
      </span>
      <span className="lit">
        <BulbMark lit />
      </span>
    </span>
    <span className="label">{label}</span>
  </Root>
);
