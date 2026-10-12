import React, { useLayoutEffect, useRef } from "react";
import styled from "styled-components";
import type { StageTx } from "../data";
import { Bulb, bulbCss } from "./Bulb";
import type { ChainNames, CircuitModel, LegModel, NodeKey, NodeState } from "./circuitModel";
import { shortHash } from "./format";
import { txName } from "./trackModel";
import { Icon, IconButton } from "./ui";
import { useCopy } from "./Toast";
import { oracleColor } from "../theme/tokens";

const Scroll = styled.div`
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
`;

const Controls = styled.div`
  display: none;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 8px;
  p {
    flex: 1;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  @media (max-width: 760px) {
    display: flex;
  }
`;

const Svg = styled.svg`
  display: block;
  width: 100%;
  min-width: 760px;
  height: auto;
  text {
    font-family: var(--font-ui);
    fill: var(--text-2);
  }
  .t-lane {
    font-size: 13px;
    fill: var(--text-3);
  }
  .t-node {
    font-size: 14px;
    font-weight: 600;
    fill: var(--text);
  }
  .t-call {
    font-size: 13px;
    fill: var(--text-2);
  }
  .t-strand {
    font-size: 12px;
    font-weight: 600;
  }
  .t-bulb {
    font-size: 22px;
    font-weight: 700;
  }
  .t-tx {
    cursor: copy;
    outline: none;
  }
  .t-tx text {
    font-family: var(--font-code);
    font-size: 13px;
    fill: var(--blue);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .t-tx:hover text {
    fill: var(--text);
  }
  .t-tx:focus-visible rect {
    stroke: var(--purple-2);
    stroke-width: 2;
  }
  .t-pending {
    font-size: 13px;
    fill: var(--text-3);
  }
  .t-tiny {
    font-size: 11px;
    fill: var(--text-2);
  }
  .t-junction {
    font-size: 15px;
    font-weight: 700;
    fill: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .node {
    fill: var(--surface-2);
    stroke: var(--stroke-strong);
    stroke-width: 1.5;
  }
  .node.done {
    stroke: var(--ok);
  }
  .node.active {
    stroke: var(--purple-2);
  }
  .node.fail {
    stroke: var(--err);
  }
  .wire {
    fill: none;
    stroke: var(--wire-idle);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .wire.live {
    stroke: var(--purple-2);
  }
  .wire.done {
    stroke: var(--ok);
  }
  .wire.fail {
    stroke: var(--err);
    stroke-dasharray: 4 5;
  }
  .strand {
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    transition:
      opacity 0.4s var(--ease-out),
      stroke-width 0.3s;
  }
  .strand.off {
    stroke: var(--wire-idle) !important;
    stroke-dasharray: 3 6;
    stroke-width: 1.5;
    opacity: 0.7;
  }
  .strand.pending {
    opacity: 0.55;
    stroke-dasharray: 6 6;
  }
  .strand.fail {
    stroke-dasharray: 2 6;
    opacity: 0.9;
  }
  .pulse {
    fill: none;
    stroke-width: 3.5;
    stroke-linecap: round;
    stroke-dasharray: 18 400;
    animation: travel 1.6s linear infinite;
  }
  .junction {
    fill: var(--surface);
    stroke-width: 2;
  }
  @keyframes travel {
    from {
      stroke-dashoffset: 418;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  ${bulbCss}
  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
      stroke-dasharray: none;
      opacity: 0.35;
    }
  }
`;

const TOP = 95;
const BOT = 290;
const MID = (TOP + BOT) / 2;
const GAP_Y = 28;

const wireCls = (s: "idle" | "active" | "done" | "fail") =>
  `wire ${s === "done" ? "done" : s === "active" ? "live" : s === "fail" ? "fail" : ""}`;

function wireBetween(a: NodeState, b: NodeState): "idle" | "active" | "done" | "fail" {
  if (a === "done" && (b === "done" || b === "active")) return "done";
  if (a === "fail") return "fail";
  if (a === "done") return "active";
  return "idle";
}

const GLYPH: Record<Exclude<NodeState, "idle">, string> = {
  done: "M-3 0.5 l2.4 2.4 l4.2 -5",
  active: "M0 -3.2 V0 l2.2 1.6",
  fail: "M0 -3.4 V0.6 M0 3 v0.1",
};

const STATE_TEXT: Record<NodeState, string> = {
  idle: "not yet",
  active: "in progress",
  done: "done",
  fail: "paused",
};

/** A status dot that also carries a check, clock or alert mark, so state is never colour alone. */
const StatusDot: React.FC<{ x: number; y: number; state: NodeState }> = ({ x, y, state }) =>
  state === "idle" ? null : (
    <g transform={`translate(${x} ${y})`}>
      <circle
        r={8}
        stroke="var(--surface)"
        strokeWidth={2}
        fill={state === "done" ? "var(--ok)" : state === "fail" ? "var(--err)" : "var(--purple-2)"}
      />
      <path d={GLYPH[state]} fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );

const TxText: React.FC<{ x: number; y: number; tx: StageTx; nodeKey: NodeKey }> = ({ x, y, tx, nodeKey }) => {
  const copy = useCopy();
  const go = () => copy(tx.hash, "Transaction hash copied");
  return (
    <g
      className="t-tx"
      role="button"
      tabIndex={0}
      aria-label={`${txName(tx)} transaction ${tx.hash}, copy`}
      data-testid={`node-tx-${nodeKey}`}
      data-hash={tx.hash}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
    >
      <title>{`${txName(tx)}: ${tx.hash} (click to copy; the local network has no explorer)`}</title>
      <rect x={x - 4} y={y - 15} width={130} height={22} rx={3} fill="transparent" stroke="none" />
      <text x={x} y={y}>{`tx ${shortHash(tx.hash)}`}</text>
    </g>
  );
};

function Node({ k, x, y, model }: { k: NodeKey; x: number; y: number; model: CircuitModel }) {
  const state = model.nodes[k];
  const tx = model.tx[k];
  return (
    <g data-testid={`node-${k}`} data-state={state}>
      <rect x={x} y={y - 40} width={156} height={80} rx={4} className={`node ${state}`} />
      <text x={x + 12} y={y - 16} className="t-node">
        {model.titles[k]}
      </text>
      <text x={x + 12} y={y + 3} className="t-call">
        {model.sub[k].length > 22 ? `${model.sub[k].slice(0, 21)}…` : model.sub[k]}
      </text>
      {tx ? (
        <TxText x={x + 12} y={y + 27} tx={tx} nodeKey={k} />
      ) : model.schematic ? null : (
        <text x={x + 12} y={y + 27} className="t-pending">
          {STATE_TEXT[state]}
        </text>
      )}
      <StatusDot x={x + 156} y={y - 40} state={state} />
    </g>
  );
}

function Leg({
  name,
  model,
  L,
  x0,
  x1,
  y,
  jx,
  dir,
}: {
  name: "dispute" | "ruling";
  model: CircuitModel;
  L: LegModel;
  x0: number;
  x1: number;
  y: number;
  jx: number;
  dir: 1 | -1;
}) {
  const n = model.oracles.length;
  const k = model.threshold;
  const total = model.selected.length;
  const met = L.attested >= k && total > 0;
  const jStroke =
    L.status === "fail"
      ? "var(--err)"
      : met
        ? "var(--ok)"
        : L.status === "live"
          ? "var(--purple-2)"
          : "var(--stroke-strong)";
  return (
    <g data-testid={`leg-${name}`} data-status={L.status}>
      {model.oracles.map((o, i) => {
        const oy = y + (i - (n - 1) / 2) * GAP_Y;
        const selected = model.selected.includes(o.id);
        const st = selected ? (L.oracles[o.id] ?? "ready") : "off";
        const a = x0;
        const b = x1;
        const m1 = a + dir * 40;
        const m2 = b - dir * 40;
        const d = `M${a} ${y} C${m1} ${y} ${m1} ${oy} ${a + dir * 70} ${oy} L${b - dir * 70} ${oy} C${m2} ${oy} ${m2} ${y} ${b} ${y}`;
        const color = oracleColor(o.id);
        const lx = dir > 0 ? a + 78 : b + 78;
        const tx = 9 + o.name.length * 7.4 + 6;
        return (
          <g key={o.id} data-testid={`strand-${name}-${o.id}`} data-state={st}>
            <path
              d={d}
              className={`strand ${st}`}
              stroke={color}
              opacity={st === "ready" ? (L.status === "ready" && name === "ruling" ? 0.35 : 0.6) : undefined}
            />
            {st === "pending" && <path d={d} className="pulse" stroke={color} />}
            <g transform={`translate(${lx} ${oy - 6})`}>
              <circle cx={0} cy={-4} r={4} fill={selected ? color : "var(--wire-idle)"} />
              <text x={9} y={0} className="t-strand" style={{ fill: selected ? "var(--text-2)" : "var(--text-3)" }}>
                {o.name}
              </text>
              {st === "attested" && (
                <path
                  d={`M${tx} -4 l3 3 l6 -7`}
                  fill="none"
                  stroke="var(--ok)"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {st === "fail" && (
                <path
                  d={`M${tx} -8 l7 7 M${tx + 7} -8 l-7 7`}
                  fill="none"
                  stroke="var(--err)"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
              )}
            </g>
          </g>
        );
      })}
      <g data-testid={`junction-${name}`} data-attested={L.attested} data-threshold={k}>
        <circle cx={jx} cy={y} r={22} className="junction" stroke={jStroke} />
        {total > 0 ? (
          <>
            <text x={jx} y={y + 1} textAnchor="middle" className="t-junction">
              {model.schematic ? k : met ? "✓" : L.attested}
            </text>
            <text x={jx} y={y + 15} textAnchor="middle" className="t-tiny">
              {model.schematic ? "agree" : `of ${k}`}
            </text>
          </>
        ) : (
          <text x={jx} y={y + 5} textAnchor="middle" className="t-junction">
            –
          </text>
        )}
        <text
          x={dir > 0 ? jx : jx + 24}
          y={dir > 0 ? y - 30 : y + 50}
          textAnchor={dir > 0 ? "middle" : "end"}
          className="t-call"
        >
          {L.caption}
        </text>
      </g>
    </g>
  );
}

export const Circuit: React.FC<{ model: CircuitModel; names: ChainNames; label: string }> = ({
  model,
  names,
  label,
}) => {
  const scroll = useRef<HTMLDivElement>(null);
  // The scroll opens on the bulb (the left edge); the arrows move along the circuit.
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = 0;
  }, []);
  const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const by = (dx: number) => scroll.current?.scrollBy({ left: dx, behavior: reduceMotion() ? "auto" : "smooth" });
  const s = model.nodes;
  const bulbColor =
    model.bulb === "on" ? "var(--bulb-on)" : model.bulb === "waiting" ? "var(--purple-2)" : model.bulb === "unknown" ? "var(--text-3)" : "var(--text-2)";
  return (
    <>
      <Controls>
        <p>Use the arrows or swipe to follow the whole circuit.</p>
        <IconButton type="button" aria-label="Scroll the circuit left" onClick={() => by(-260)}>
          <Icon.left />
        </IconButton>
        <IconButton type="button" aria-label="Scroll the circuit right" onClick={() => by(260)}>
          <Icon.right />
        </IconButton>
      </Controls>
      <Scroll ref={scroll} data-testid="circuit-scroll" tabIndex={0} role="region" aria-label="Circuit, scrolls sideways">
        <Svg viewBox="0 0 1000 380" role="img" aria-label={label} data-testid="circuit">
          <text x={180} y={32} className="t-lane">{`Request leg · ${names.foreign} → ${names.home}`}</text>
          <text x={180} y={368} className="t-lane">{`Decision leg · ${names.home} → ${names.foreign}`}</text>
          <path d={`M95 ${MID - 88} V${TOP} H180`} className={wireCls(s.foreignOut === "idle" ? "idle" : "done")} />
          <path d={`M180 ${BOT} H95 V${MID + 82}`} className={wireCls(s.foreignIn === "done" ? "done" : "idle")} />
          <Node k="foreignOut" x={180} y={TOP} model={model} />
          <Node k="homeIn" x={650} y={TOP} model={model} />
          <Node k="court" x={830} y={MID} model={model} />
          <Node k="homeOut" x={650} y={BOT} model={model} />
          <Node k="foreignIn" x={180} y={BOT} model={model} />
          <path d={`M800 ${TOP} H905 V${MID - 40}`} className={wireCls(wireBetween(s.homeIn, s.court))} />
          <path d={`M905 ${MID + 40} V${BOT} H800`} className={wireCls(wireBetween(s.court, s.homeOut))} />
          <Leg name="dispute" model={model} L={model.dispute} x0={336} x1={568} y={TOP} jx={590} dir={1} />
          <path
            d={`M612 ${TOP} H650`}
            className={wireCls(s.homeIn === "idle" ? "idle" : s.homeIn === "fail" ? "fail" : "done")}
          />
          <Leg name="ruling" model={model} L={model.ruling} x0={650} x1={408} y={BOT} jx={386} dir={-1} />
          <path
            d={`M336 ${BOT} H364`}
            className={wireCls(s.foreignIn === "idle" ? "idle" : s.foreignIn === "fail" ? "fail" : "done")}
          />
          <Bulb cx={95} cy={MID} state={model.bulb} testId="circuit-bulb" />
          <text x={200} y={MID - 2} className="t-bulb" style={{ fill: bulbColor }} data-testid="bulb-label">
            {model.bulbLabel[0]}
          </text>
          <text x={200} y={MID + 20} className="t-call">
            {model.bulbLabel[1]}
          </text>
        </Svg>
      </Scroll>
    </>
  );
};
