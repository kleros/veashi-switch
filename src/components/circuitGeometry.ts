// The circuit's layout (viewBox 0 0 1000 380) and its connectors, listed in the order the message travels: from the
// bulb along the top lane to the court, back along the bottom lane to the bulb. Every connector is drawn in that
// direction and carries one arrow that points the same way. Pure, so a unit test can check it without a DOM.
import type { CircuitModel, LegModel, NodeKey, NodeState, StrandState } from "./circuitModel";

export const TOP = 95;
export const BOT = 290;
export const MID = (TOP + BOT) / 2;
export const GAP_Y = 28;
export const NODE_W = 156;
export const NODE_H = 80;
export const JUNCTION_R = 22;

/** Each node's box: x is its left edge, y its vertical centre. */
export const NODE_AT: Record<NodeKey, { x: number; y: number }> = {
  foreignOut: { x: 180, y: TOP },
  homeIn: { x: 650, y: TOP },
  court: { x: 830, y: MID },
  homeOut: { x: 650, y: BOT },
  foreignIn: { x: 180, y: BOT },
};

export const BULB_AT = { cx: 95, cy: MID };
const BULB_TOP = MID - 88; // just above the glass
const BULB_FOOT = MID + 82; // just below the last screw ring

export type LegName = "dispute" | "ruling";

/** A leg's strands run from x0 (the sending node's edge) to x1 (the junction's edge); dir is the way they run. */
export interface LegGeometry {
  x0: number;
  x1: number;
  y: number;
  jx: number;
  dir: 1 | -1;
}

export const LEG_AT: Record<LegName, LegGeometry> = {
  dispute: { x0: 336, x1: 568, y: TOP, jx: 590, dir: 1 },
  ruling: { x0: 650, x1: 408, y: BOT, jx: 386, dir: -1 },
};

/** The strand of oracle row i of n: its height on the straight run. */
export const strandY = (g: LegGeometry, i: number, n: number) => g.y + (i - (n - 1) / 2) * GAP_Y;

// A strand fans out from the sending node over 70 units, runs straight, and gathers into the junction over 70.
const FAN = 70;
const FAN_CTRL = 40;

export function strandPath(g: LegGeometry, oy: number): string {
  const { x0: a, x1: b, y, dir } = g;
  const m1 = a + dir * FAN_CTRL;
  const m2 = b - dir * FAN_CTRL;
  return `M${a} ${y} C${m1} ${y} ${m1} ${oy} ${a + dir * FAN} ${oy} L${b - dir * FAN} ${oy} C${m2} ${oy} ${m2} ${y} ${b} ${y}`;
}

const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};
const cubicSlope = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
};

/**
 * Where a strand's arrow sits: three quarters along the fan-out curve, where the strands are well apart (no two
 * arrows touch, even with four oracles) and well before the oracle labels, which start where the curve ends.
 */
export const STRAND_ARROW_T = 0.75;

export function strandArrow(g: LegGeometry, oy: number): Arrow {
  const { x0: a, y, dir } = g;
  const xs = [a, a + dir * FAN_CTRL, a + dir * FAN_CTRL, a + dir * FAN] as const;
  const ys = [y, y, oy, oy] as const;
  const t = STRAND_ARROW_T;
  const dx = cubicSlope(...xs, t);
  const dy = cubicSlope(...ys, t);
  return { x: cubic(...xs, t), y: cubic(...ys, t), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** The arrow: an open chevron with its tip at the origin, pointing along +x; drawn rotated to its heading. */
export const ARROW_BACK = 5.5;
export const ARROW_HALF = 5;
export const ARROW_PATH = `M${-ARROW_BACK} ${-ARROW_HALF} L0 0 L${-ARROW_BACK} ${ARROW_HALF}`;

export type WireState = "idle" | "active" | "done" | "fail";
export type Heading = "right" | "down" | "left" | "up";
export type Stop = "bulb" | NodeKey | "junction-dispute" | "junction-ruling";

/** An arrow's tip and its heading in degrees (0 right, 90 down, 180 left, 270 up: SVG's y grows downward). */
export interface Arrow {
  x: number;
  y: number;
  angle: number;
}

interface Base {
  id: string;
  from: Stop;
  to: Stop;
  /** The way the message moves along this connector, overall (a strand's own heading tilts with its curve). */
  heading: Heading;
  arrow: Arrow;
}

export interface WireConnector extends Base {
  kind: "wire";
  /** Drawn in the direction of travel; it ends at the arrow's tip. */
  d: string;
  state: WireState;
}

export interface StrandConnector extends Base {
  kind: "strand";
  leg: LegName;
  oracle: number;
  strand: StrandState;
}

export type Connector = WireConnector | StrandConnector;

const ANGLE: Record<Heading, number> = { right: 0, down: 90, left: 180, up: 270 };

/** The wire between two nodes, by the states of the node it leaves and the node it enters. */
export function wireBetween(a: NodeState, b: NodeState): WireState {
  if (a === "done" && (b === "done" || b === "active")) return "done";
  if (a === "fail") return "fail";
  // into a node that failed (the court could not open the case): red, as a wire from a junction into one is
  if (b === "fail") return "fail";
  if (a === "done") return "active";
  return "idle";
}

/** The wire into a node from its junction: its colour follows the node it enters. */
const intoNode = (s: NodeState): WireState => (s === "idle" ? "idle" : s === "fail" ? "fail" : "done");

// Arrow tips stop 2 units short of a node's edge: the box's 1.5 stroke and the chevron's round join then just meet.
const TIP_GAP = 2;
const left = (k: NodeKey) => NODE_AT[k].x;
const right = (k: NodeKey) => NODE_AT[k].x + NODE_W;
const top = (k: NodeKey) => NODE_AT[k].y - NODE_H / 2;
const bottom = (k: NodeKey) => NODE_AT[k].y + NODE_H / 2;

function wire(id: string, from: Stop, to: Stop, d: string, end: { x: number; y: number }, heading: Heading, state: WireState): WireConnector {
  return { kind: "wire", id, from, to, d, state, heading, arrow: { ...end, angle: ANGLE[heading] } };
}

function strands(model: CircuitModel, leg: LegName, L: LegModel): StrandConnector[] {
  const g = LEG_AT[leg];
  const n = model.oracles.length;
  const from: NodeKey = leg === "dispute" ? "foreignOut" : "homeOut";
  const out: StrandConnector[] = [];
  model.oracles.forEach((o, i) => {
    // An oracle that is not selected carries nothing: its strand is drawn off and has no arrow.
    if (!model.selected.includes(o.id)) return;
    out.push({
      kind: "strand",
      id: `strand-${leg}-${o.id}`,
      from,
      to: `junction-${leg}`,
      leg,
      oracle: o.id,
      strand: L.oracles[o.id] ?? "ready",
      heading: g.dir > 0 ? "right" : "left",
      arrow: strandArrow(g, strandY(g, i, n)),
    });
  });
  return out;
}

/** Every connector of the circuit, in the order the message travels, each with its arrow. */
export function circuitConnectors(model: CircuitModel): Connector[] {
  const s = model.nodes;
  const { cx } = BULB_AT;
  const dj = LEG_AT.dispute;
  const rj = LEG_AT.ruling;
  const courtX = 905;
  const toRequest = { x: left("foreignOut") - TIP_GAP, y: TOP };
  const toDelivered = { x: left("homeIn") - TIP_GAP, y: TOP };
  const toCourt = { x: courtX, y: top("court") - TIP_GAP };
  const toReturning = { x: right("homeOut") + TIP_GAP, y: BOT };
  const toUpdated = { x: right("foreignIn") + TIP_GAP, y: BOT };
  const toBulb = { x: cx, y: BULB_FOOT };
  return [
    wire("bulb-request", "bulb", "foreignOut", `M${cx} ${BULB_TOP} V${TOP} H${toRequest.x}`, toRequest, "right", s.foreignOut === "idle" ? "idle" : "done"),
    ...strands(model, "dispute", model.dispute),
    wire(
      "junction-delivered",
      "junction-dispute",
      "homeIn",
      `M${dj.jx + JUNCTION_R} ${TOP} H${toDelivered.x}`,
      toDelivered,
      "right",
      intoNode(s.homeIn),
    ),
    wire("delivered-court", "homeIn", "court", `M${right("homeIn")} ${TOP} H${courtX} V${toCourt.y}`, toCourt, "down", wireBetween(s.homeIn, s.court)),
    wire("court-returning", "court", "homeOut", `M${courtX} ${bottom("court")} V${BOT} H${toReturning.x}`, toReturning, "left", wireBetween(s.court, s.homeOut)),
    ...strands(model, "ruling", model.ruling),
    wire(
      "junction-updated",
      "junction-ruling",
      "foreignIn",
      `M${rj.jx - JUNCTION_R} ${BOT} H${toUpdated.x}`,
      toUpdated,
      "left",
      intoNode(s.foreignIn),
    ),
    wire("updated-bulb", "foreignIn", "bulb", `M${left("foreignIn")} ${BOT} H${cx} V${toBulb.y}`, toBulb, "up", s.foreignIn === "done" ? "done" : "idle"),
  ];
}

/** A strand's opacity by its state. */
export function strandOpacity(st: StrandState, leg: LegName, legStatus: LegModel["status"]): number {
  if (st === "ready") return legStatus === "ready" && leg === "ruling" ? 0.35 : 0.6;
  if (st === "pending") return 0.55;
  if (st === "fail") return 0.9;
  if (st === "off") return 0.7;
  return 1;
}

/**
 * A strand's arrow is never fainter than this, even on a dimmed strand (waiting at 0.35, pending at 0.55): the
 * direction must read at 3:1 on the surface in every oracle colour (4.0:1 dark, 3.3:1 light at 0.85).
 */
export const ARROW_MIN_OPACITY = 0.85;

/** The opacity of a strand's arrow: its strand's, raised to ARROW_MIN_OPACITY. */
export function strandArrowOpacity(st: StrandState, leg: LegName, legStatus: LegModel["status"]): number {
  return Math.max(strandOpacity(st, leg, legStatus), ARROW_MIN_OPACITY);
}

/** The order of travel in one plain sentence, for the circuit's accessible name. */
export function travelOrder(model: CircuitModel): string {
  const t = model.titles;
  return `In order: the bulb, ${t.foreignOut}, the oracles, ${t.homeIn}, ${t.court}, ${t.homeOut}, the oracles, ${t.foreignIn}, and back to the bulb.`;
}
