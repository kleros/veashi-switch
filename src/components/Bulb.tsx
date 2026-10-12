import React from "react";
import styled, { css } from "styled-components";
import type { BulbState } from "./circuitModel";

/** The bulb's look, shared by the circuit's SVG and the standalone bulb in the status panel. */
export const bulbCss = css`
  .bulb-glass {
    fill: var(--bulb-glass);
    stroke: var(--stroke-strong);
    stroke-width: 2;
    transition:
      fill 0.8s var(--ease-out),
      stroke 0.8s;
  }
  .bulb-halo {
    fill: var(--bulb-halo);
    opacity: 0;
    transition: opacity 1s var(--ease-out);
  }
  .bulb-filament {
    fill: none;
    stroke: var(--text-3);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: stroke 0.6s;
  }
  .bulb-screw {
    fill: var(--stroke-strong);
  }
  .is-on .bulb-glass {
    fill: var(--bulb-on);
    stroke: var(--bulb-on);
    filter: drop-shadow(0 0 18px var(--bulb-on));
  }
  .is-on .bulb-halo {
    opacity: 1;
  }
  .is-on .bulb-filament {
    stroke: var(--bulb-filament-on);
  }
  .is-unknown .bulb-glass {
    fill: none;
    stroke-dasharray: 5 5;
  }
  .is-unknown .bulb-filament {
    stroke-dasharray: 2 4;
    opacity: 0.6;
  }
  .is-waiting .bulb-filament {
    animation: flicker 2.4s ease-in-out infinite;
  }
  @keyframes flicker {
    0%,
    100% {
      stroke: var(--text-3);
    }
    50% {
      stroke: var(--purple-2);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bulb-glass,
    .bulb-halo,
    .bulb-filament {
      transition: none;
    }
    .is-waiting .bulb-filament {
      animation: none;
      stroke: var(--purple-2);
    }
    .is-on .bulb-glass {
      filter: none;
    }
  }
`;

const label = (state: BulbState) =>
  `Lightbulb ${state === "waiting" ? "waiting for the decision" : state === "unknown" ? "state unavailable" : state}`;

/**
 * The lightbulb, custom SVG. Off: dark glass; waiting: the filament flickers (still under prefers-reduced-motion);
 * on: warm glass and a halo.
 */
export const Bulb: React.FC<{ cx: number; cy: number; state: BulbState; scale?: number; testId?: string }> = ({
  cx,
  cy,
  state,
  scale = 1.4,
  testId = "bulb",
}) => (
  <g
    className={`bulb ${state === "on" ? "is-on" : state === "waiting" ? "is-waiting" : state === "unknown" ? "is-unknown" : "is-off"}`}
    data-testid={testId}
    data-state={state}
    role="img"
    aria-label={label(state)}
    transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}
  >
    <circle className="bulb-halo" cx={cx} cy={cy - 14} r={66} />
    <circle className="bulb-halo" cx={cx} cy={cy - 14} r={46} />
    <path
      className="bulb-glass"
      d={`M${cx} ${cy - 62} c-28 0 -46 21 -46 45 c0 17 9 29 19 38 c6 6 9 12 9 19 v8 h36 v-8 c0 -7 3 -13 9 -19 c10 -9 19 -21 19 -38 c0 -24 -18 -45 -46 -45 z`}
    />
    <path
      className="bulb-filament"
      d={`M${cx - 11} ${cy + 22} V${cy + 4} l5 -12 l6 10 l6 -10 l5 12 V${cy + 22}`}
    />
    {state === "unknown" && (
      <text className="bulb-unknown-mark" x={cx} y={cy - 18} textAnchor="middle" fontSize={30} fill="var(--text-3)">
        ?
      </text>
    )}
    <rect className="bulb-screw" x={cx - 18} y={cy + 32} width={36} height={7} rx={2} />
    <rect className="bulb-screw" x={cx - 16} y={cy + 42} width={32} height={6} rx={2} opacity={0.8} />
    <rect className="bulb-screw" x={cx - 9} y={cy + 51} width={18} height={6} rx={3} opacity={0.6} />
  </g>
);

const Box = styled.svg`
  width: 96px;
  height: 112px;
  flex: none;
  overflow: visible;
  ${bulbCss}
`;

/** The bulb on its own (the status panel), always in view: the plain-language state sits beside it. */
export const BulbSvg: React.FC<{ state: BulbState }> = ({ state }) => (
  <Box viewBox="0 0 120 140" aria-hidden="false" role="group" aria-label="Bulb">
    <Bulb cx={60} cy={72} state={state} scale={1} />
  </Box>
);
