import { describe, expect, it } from "vitest";
import type { Oracle, OracleReport, RequestStage, StageTx, SwitchRequest } from "../data";
import { previewModel, requestModel, type CircuitModel, type NodeKey } from "./circuitModel";
import {
  ARROW_BACK,
  ARROW_HALF,
  ARROW_MIN_OPACITY,
  ARROW_PATH,
  BULB_AT,
  circuitConnectors,
  JUNCTION_R,
  LABEL_MAX,
  labelX,
  LEG_AT,
  NODE_AT,
  NODE_H,
  NODE_W,
  strandArrowOpacity,
  strandLabel,
  strandOpacity,
  strandPath,
  strandY,
  travelOrder,
  type Connector,
  type Stop,
} from "./circuitGeometry";

const names = { foreign: "Base-like", home: "Arbitrum-like" };
const mkOracles = (list: string[]): Oracle[] =>
  list.map((name, id) => ({ id, name, via: `${name}Reporter · ${name}Adapter`, enabled: true, bridgingCostWei: 1n }));
const four = mkOracles(["Vea", "CCIP", "LayerZero", "deBridge"]);
const three = mkOracles(["CCIP", "layer-zero", "Axelar"]);
// the longest name shown in full (LABEL_MAX), and a longer one, cut
const long = mkOracles(["Wormhole V2", "Chainlink CCIPv2", "Axelar"]);

const tx = (stage: StageTx["stage"], chain: StageTx["chain"], n: number): StageTx => ({
  stage,
  chain,
  label: stage,
  hash: `0x${n.toString(16).padStart(64, "0")}`,
});
const rep = (leg: OracleReport["leg"], status: OracleReport["status"], ...ids: number[]): OracleReport[] =>
  ids.map((oracleId) => ({ oracleId, leg, status }));

function req(stage: RequestStage, over: Partial<SwitchRequest> = {}): SwitchRequest {
  return {
    disputeId: 7n,
    homeDisputeId: null,
    owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    selection: { oracleIds: [0, 1, 2], threshold: 2 },
    paid: { token: "native", amount: 1n },
    stage,
    ruling: 0,
    reports: [],
    txs: [tx("submitted", "foreign", 1)],
    error: null,
    creation: null,
    refund: null,
    actions: [],
    updatedAt: 0,
    ...over,
  };
}

const sent = tx("submitted", "foreign", 1);
const received = tx("dispute-received", "home", 2);
const ruled = tx("ruled", "home", 3);
const switched = tx("switched", "foreign", 4);
const creationFailed = tx("creation-failed", "home", 5);
const closed = tx("closed", "foreign", 6);
const delivered = tx("dispute-delivered", "home", 7);
const dOk = rep("dispute", "reported", 0, 1);

/** Every state the circuit draws: the preview (idle), each stage in progress, done, paused and the creation failure. */
const CASES: [string, CircuitModel][] = [
  ["preview, idle", previewModel(four, [0, 1, 2], 2, { kind: "known", on: false }, names)],
  ["preview, one oracle", previewModel(three, [1], 1, { kind: "loading" }, names)],
  ["preview, no oracle chosen", previewModel(four, [], 1, { kind: "loading" }, names)],
  ["sent, request leg live", requestModel(req("submitted"), four, names)],
  ["request leg, 1 of 2", requestModel(req("dispute-relaying", { reports: [...rep("dispute", "pending", 0, 1), ...rep("dispute", "reported", 2)] }), four, names)],
  ["request leg, 2 of 2: Delivered next", requestModel(req("dispute-relaying", { reports: dOk }), four, names)],
  ["delivered, the court opening the case", requestModel(req("dispute-delivered", { txs: [sent, delivered], reports: dOk }), four, names)],
  ["court open", requestModel(req("dispute-received", { homeDisputeId: 0n, txs: [sent, received] }), four, names)],
  ["court ruled", requestModel(req("ruled", { homeDisputeId: 0n, ruling: 1, txs: [sent, received, ruled] }), four, names)],
  [
    "decision leg live",
    requestModel(
      req("ruling-relaying", { homeDisputeId: 0n, ruling: 1, txs: [sent, received, ruled], reports: [...rep("dispute", "reported", 0, 1), ...rep("ruling", "pending", 0, 1, 2)] }),
      four,
      names,
    ),
  ],
  [
    "decision leg, 2 of 2: Bulb updated next",
    requestModel(
      req("ruling-relaying", { homeDisputeId: 0n, ruling: 1, txs: [sent, received, ruled], reports: [...dOk, ...rep("ruling", "reported", 0, 1)] }),
      four,
      names,
    ),
  ],
  [
    "done, ruling refused",
    requestModel(req("switched", { homeDisputeId: 0n, ruling: 0, txs: [sent, received, ruled, switched], reports: dOk }), four, names, { kind: "known", on: false }),
  ],
  [
    "done, long oracle names reported on both legs",
    requestModel(
      req("switched", { homeDisputeId: 0n, ruling: 1, txs: [sent, received, ruled, switched], reports: [...dOk, ...rep("ruling", "reported", 0, 1)] }),
      long,
      names,
      { kind: "known", on: true },
    ),
  ],
  [
    "done (testnet oracles)",
    requestModel(
      req("switched", { homeDisputeId: 0n, ruling: 2, txs: [sent, received, ruled, switched], selection: { oracleIds: [0, 1, 2], threshold: 2 } }),
      three,
      names,
      { kind: "known", on: false },
    ),
  ],
  ["paused on the request leg", requestModel(req("failed", { reports: [...rep("dispute", "reported", 2), ...rep("dispute", "failed", 1)] }), four, names)],
  ["paused at delivery", requestModel(req("failed", { error: "short", reports: rep("dispute", "reported", 0, 1) }), four, names)],
  ["paused on the decision leg", requestModel(req("failed", { homeDisputeId: 0n, ruling: 1, txs: [sent, received, ruled], reports: dOk }), four, names)],
  [
    "paused updating the bulb",
    requestModel(req("failed", { homeDisputeId: 0n, ruling: 1, txs: [sent, received, ruled], reports: [...dOk, ...rep("ruling", "reported", 0, 1)] }), four, names),
  ],
  [
    "court cannot open the case",
    requestModel(req("dispute-delivered", { actions: ["send-failure"], txs: [sent, tx("dispute-delivered", "home", 7)], creation: { state: "waiting", deliveredAt: 0, failableAt: 1, blocker: "short" } }), four, names),
  ],
  ["failure sent", requestModel(req("creation-failed", { txs: [sent, delivered, creationFailed], reports: dOk }), four, names)],
  [
    "failure returning",
    requestModel(req("failure-relaying", { txs: [sent, delivered, creationFailed], reports: [...dOk, ...rep("ruling", "pending", 0, 1, 2)] }), four, names),
  ],
  [
    "paused returning the failure",
    requestModel(req("failed", { txs: [sent, delivered, creationFailed], reports: [...dOk, ...rep("ruling", "reported", 0, 1)] }), four, names),
  ],
  [
    "failure returned, request closed",
    requestModel(
      req("closed", { txs: [sent, tx("dispute-delivered", "home", 7), creationFailed, closed], selection: { oracleIds: [1], threshold: 1 }, reports: [...rep("dispute", "reported", 1), ...rep("ruling", "reported", 1)] }),
      three,
      names,
      { kind: "known", on: false },
    ),
  ],
];

type Pt = { x: number; y: number };
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

/** A wire's points: its d uses only M, H and V. */
function wirePoints(d: string): Pt[] {
  const pts: Pt[] = [];
  for (const [, cmd, rest] of d.matchAll(/([MHV])([^MHV]+)/g)) {
    const n = rest.trim().split(/\s+/).map(Number);
    const last = pts[pts.length - 1];
    if (cmd === "M") pts.push({ x: n[0], y: n[1] });
    else if (cmd === "H") pts.push({ x: n[0], y: last.y });
    else pts.push({ x: last.x, y: n[0] });
  }
  return pts;
}

/** A strand's first and last points: its d starts with M and ends with the C's end point. */
function strandEnds(d: string): [Pt, Pt] {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return [
    { x: n[0], y: n[1] },
    { x: n[n.length - 2], y: n[n.length - 1] },
  ];
}

/** Distance from a point to a stop's outline: a node's box, a junction's circle, the bulb's glass and screw. */
function distTo(stop: Stop, p: Pt): number {
  if (stop === "bulb") {
    // the glass top and the screw foot, scaled 1.4 about the centre (Bulb.tsx)
    const top = BULB_AT.cy - 62 * 1.4;
    const foot = BULB_AT.cy + 57 * 1.4;
    return Math.min(Math.hypot(p.x - BULB_AT.cx, p.y - top), Math.hypot(p.x - BULB_AT.cx, p.y - foot));
  }
  if (stop === "junction-dispute" || stop === "junction-ruling") {
    const g = LEG_AT[stop === "junction-dispute" ? "dispute" : "ruling"];
    return Math.abs(Math.hypot(p.x - g.jx, p.y - g.y) - JUNCTION_R);
  }
  const { x, y } = NODE_AT[stop];
  const dx = Math.max(x - p.x, 0, p.x - (x + NODE_W));
  const dy = Math.max(y - NODE_H / 2 - p.y, 0, p.y - (y + NODE_H / 2));
  return Math.hypot(dx, dy);
}

/** The chevron as drawn, ARROW_PATH's three points (an arm's end, the tip, the other arm's end), on its connector. */
const ARROW_POINTS = ARROW_PATH.match(/-?\d+(\.\d+)?/g)!.map(Number);
function chevron(c: Connector): Pt[] {
  const a = (c.arrow.angle * Math.PI) / 180;
  const at = (lx: number, ly: number) => ({
    x: c.arrow.x + lx * Math.cos(a) - ly * Math.sin(a),
    y: c.arrow.y + lx * Math.sin(a) + ly * Math.cos(a),
  });
  const p = ARROW_POINTS;
  return [at(p[0], p[1]), at(p[2], p[3]), at(p[4], p[5])];
}

const HEADING: Record<string, Pt> = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, down: { x: 0, y: 1 }, up: { x: 0, y: -1 } };

/** The order of travel, independent of the code under test: the message's route from the bulb and back. */
const ROUTE: [Stop, Stop, string][] = [
  ["bulb", "foreignOut", "right"],
  ["foreignOut", "junction-dispute", "right"],
  ["junction-dispute", "homeIn", "right"],
  ["homeIn", "court", "down"],
  ["court", "homeOut", "left"],
  ["homeOut", "junction-ruling", "left"],
  ["junction-ruling", "foreignIn", "left"],
  ["foreignIn", "bulb", "up"],
];

describe("ARROW_PATH", () => {
  it("is a chevron with its tip at the origin and both arms behind it, so it points along +x", () => {
    expect(ARROW_PATH).toMatch(/^M\S+ \S+ L\S+ \S+ L\S+ \S+$/);
    expect(ARROW_POINTS).toEqual([-ARROW_BACK, -ARROW_HALF, 0, 0, -ARROW_BACK, ARROW_HALF]);
  });
});

describe("circuitConnectors", () => {
  for (const [label, model] of CASES) {
    describe(label, () => {
      const cs = circuitConnectors(model);

      it("lists every hop of the route once, in the order the message travels, each strand of a selected oracle in parallel", () => {
        const hops: string[] = [];
        for (const c of cs) {
          const hop = `${c.from}→${c.to}`;
          if (hops[hops.length - 1] !== hop) hops.push(hop);
        }
        const route = ROUTE.filter(([from]) => model.selected.length > 0 || (from !== "foreignOut" && from !== "homeOut"));
        expect(hops).toEqual(route.map(([a, b]) => `${a}→${b}`));
        for (const leg of ["dispute", "ruling"] as const)
          expect(cs.filter((c) => c.kind === "strand" && c.leg === leg).map((c) => (c.kind === "strand" ? c.oracle : -1))).toEqual(
            model.oracles.filter((o) => model.selected.includes(o.id)).map((o) => o.id),
          );
      });

      it("points each arrow the way the message moves on its connector", () => {
        for (const c of cs) {
          const want = ROUTE.find(([a, b]) => a === c.from && b === c.to)![2];
          expect(c.heading, c.id).toBe(want);
          const a = (c.arrow.angle * Math.PI) / 180;
          const h = { x: Math.cos(a), y: Math.sin(a) };
          const w = HEADING[want];
          // a wire's arrow is exactly on the axis; a strand's tilts with its curve but never turns back
          expect(h.x * w.x + h.y * w.y, c.id).toBeGreaterThan(c.kind === "wire" ? 0.9999 : 0.7);
        }
      });

      it("draws each wire from where the message leaves to where it arrives, ending at its arrow's tip", () => {
        for (const c of cs) {
          if (c.kind !== "wire") continue;
          const pts = wirePoints(c.d);
          const start = pts[0];
          const end = pts[pts.length - 1];
          const before = pts[pts.length - 2];
          expect(distTo(c.from, start), `${c.id} starts on ${c.from}`).toBeLessThanOrEqual(1.5);
          expect(distTo(c.to, end), `${c.id} ends at ${c.to}`).toBeLessThanOrEqual(2.5);
          expect(distTo(c.to, end), `${c.id} stays outside ${c.to}`).toBeGreaterThan(0.75);
          expect(near(end.x, c.arrow.x) && near(end.y, c.arrow.y), `${c.id}: the tip is the wire's end`).toBe(true);
          const len = Math.hypot(end.x - before.x, end.y - before.y);
          const a = (c.arrow.angle * Math.PI) / 180;
          expect(near((end.x - before.x) / len, Math.cos(a), 1e-9) && near((end.y - before.y) / len, Math.sin(a), 1e-9), `${c.id}: the last segment runs along the arrow`).toBe(true);
          expect(len, `${c.id}: the last segment is longer than the chevron`).toBeGreaterThan(ARROW_BACK + 2);
        }
      });

      it("puts each strand's arrow on its strand, tangent to it, between the node it leaves and the junction", () => {
        for (const c of cs) {
          if (c.kind !== "strand") continue;
          const g = LEG_AT[c.leg];
          const i = model.oracles.findIndex((o) => o.id === c.oracle);
          const oy = strandY(g, i, model.oracles.length);
          const d = strandPath(g, oy);
          const [start, end] = strandEnds(d);
          expect(distTo(c.from, start), `${c.id} starts on ${c.from}`).toBeLessThanOrEqual(0.01);
          expect(distTo(c.to, end), `${c.id} ends on ${c.to}`).toBeLessThanOrEqual(0.01);
          // the fan-out curve, read back from the strand's own d and sampled: the tip lies on it, the heading follows it
          const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
          const [x0, y0, x1, y1, x2, y2, x3, y3] = n;
          const curve = (t: number) => {
            const u = 1 - t;
            return {
              x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
              y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
            };
          };
          let best = { t: 0, d: Infinity };
          for (let t = 0; t <= 1; t += 0.0005) {
            const p = curve(t);
            const dd = Math.hypot(p.x - c.arrow.x, p.y - c.arrow.y);
            if (dd < best.d) best = { t, d: dd };
          }
          expect(best.d, `${c.id}: the tip lies on the strand`).toBeLessThan(0.05);
          const p0 = curve(best.t - 0.001);
          const p1 = curve(best.t + 0.001);
          const tl = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          const ang = (c.arrow.angle * Math.PI) / 180;
          expect(((p1.x - p0.x) / tl) * Math.cos(ang) + ((p1.y - p0.y) / tl) * Math.sin(ang), `${c.id}: along the strand`).toBeGreaterThan(0.999);
          // and clear of the oracle label (dot, name as shown and its ✓ or ✕: Circuit.tsx), with 4 units to spare
          const xs = chevron(c).map((p) => p.x);
          const lx = labelX(g);
          const labelEnd = lx + 9 + strandLabel(model.oracles[i].name).length * 7.4 + 6 + 9;
          if (g.dir > 0) expect(Math.max(...xs) + 1, c.id).toBeLessThan(lx - 4 - 4);
          else expect(Math.min(...xs) - 1, c.id).toBeGreaterThan(labelEnd + 4);
        }
      });

      it("keeps every arrow clear of the node boxes, the junctions, the bulb and the other arrows", () => {
        const boxes = cs.map((c) => {
          const pts = chevron(c);
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          // the stroke is 2 wide: one unit around the points
          return { id: c.id, x0: Math.min(...xs) - 1, x1: Math.max(...xs) + 1, y0: Math.min(...ys) - 1, y1: Math.max(...ys) + 1 };
        });
        for (const b of boxes) {
          for (const k of Object.keys(NODE_AT) as NodeKey[]) {
            const { x, y } = NODE_AT[k];
            const hit = b.x1 > x - 0.75 && b.x0 < x + NODE_W + 0.75 && b.y1 > y - NODE_H / 2 - 0.75 && b.y0 < y + NODE_H / 2 + 0.75;
            expect(hit, `${b.id} overlaps node ${k}`).toBe(false);
          }
          for (const g of Object.values(LEG_AT)) {
            const cx = Math.max(b.x0, Math.min(g.jx, b.x1));
            const cy = Math.max(b.y0, Math.min(g.y, b.y1));
            expect(Math.hypot(cx - g.jx, cy - g.y), `${b.id} overlaps a junction`).toBeGreaterThan(JUNCTION_R + 1);
          }
          // the bulb (Bulb.tsx, scaled 1.4 about its centre): the glass, about a circle of radius 46 raised 17, and
          // the screw rings, 36 wide from 32 to 57 below the centre
          const { cx, cy } = BULB_AT;
          const gy = cy - 17 * 1.4;
          const glass = Math.hypot(Math.max(b.x0, Math.min(cx, b.x1)) - cx, Math.max(b.y0, Math.min(gy, b.y1)) - gy);
          expect(glass, `${b.id} overlaps the bulb glass`).toBeGreaterThan(46 * 1.4);
          const screw = b.x1 > cx - 18 * 1.4 && b.x0 < cx + 18 * 1.4 && b.y1 > cy + 32 * 1.4 && b.y0 < cy + 57 * 1.4;
          expect(screw, `${b.id} overlaps the bulb screw`).toBe(false);
          for (const o of boxes) {
            if (o.id === b.id) continue;
            const hit = b.x1 > o.x0 && b.x0 < o.x1 && b.y1 > o.y0 && b.y0 < o.y1;
            expect(hit, `${b.id} overlaps ${o.id}`).toBe(false);
          }
        }
      });
    });
  }

  // Each wire's state (and so its arrow's colour), in the order of travel: bulb → Request sent, junction → Delivered,
  // Delivered → Decision, Decision → Decision returning, junction → Bulb updated, Bulb updated → bulb. Written out by
  // hand from the node states, so a change to any wire's rule shows here.
  const WIRE_STATES: Record<string, string> = {
    "preview, idle": "idle idle idle idle idle idle",
    "preview, one oracle": "idle idle idle idle idle idle",
    "preview, no oracle chosen": "idle idle idle idle idle idle",
    "sent, request leg live": "done idle idle idle idle idle",
    "request leg, 1 of 2": "done idle idle idle idle idle",
    "request leg, 2 of 2: Delivered next": "done done idle idle idle idle",
    "delivered, the court opening the case": "done done done idle idle idle",
    "court open": "done done done idle idle idle",
    "court ruled": "done done done done idle idle",
    "decision leg live": "done done done done idle idle",
    "decision leg, 2 of 2: Bulb updated next": "done done done done done idle",
    "done, ruling refused": "done done done done done done",
    "done, long oracle names reported on both legs": "done done done done done done",
    "done (testnet oracles)": "done done done done done done",
    "paused on the request leg": "done idle idle idle idle idle",
    "paused at delivery": "done fail fail idle idle idle",
    "paused on the decision leg": "done done done done idle idle",
    "paused updating the bulb": "done done done done fail idle",
    // the court could not open the case: the wires on both sides of it are red, before and after the failure returns
    "court cannot open the case": "done done fail fail idle idle",
    "failure sent": "done done fail fail idle idle",
    "failure returning": "done done fail fail idle idle",
    "paused returning the failure": "done done fail fail fail idle",
    "failure returned, request closed": "done done fail fail done done",
  };

  it("gives each wire, and so its arrow, the state of the hop it draws, in every case", () => {
    expect(Object.keys(WIRE_STATES).sort()).toEqual(CASES.map(([l]) => l).sort());
    for (const [label, model] of CASES) {
      const cs = circuitConnectors(model);
      expect(cs.filter((c) => c.kind === "wire").map((c) => c.id), label).toEqual([
        "bulb-request",
        "junction-delivered",
        "delivered-court",
        "court-returning",
        "junction-updated",
        "updated-bulb",
      ]);
      expect(cs.map((c) => (c.kind === "wire" ? c.state : "")).filter(Boolean).join(" "), label).toBe(WIRE_STATES[label]);
    }
  });

  it("keeps the strands' opacities and draws a strand's arrow at no less than 0.85, so a faint strand still shows its way", () => {
    expect(strandOpacity("ready", "ruling", "ready")).toBe(0.35);
    expect(strandOpacity("ready", "dispute", "ready")).toBe(0.6);
    expect(strandOpacity("pending", "dispute", "live")).toBe(0.55);
    expect(strandOpacity("attested", "ruling", "done")).toBe(1);
    expect(ARROW_MIN_OPACITY).toBe(0.85);
    expect(strandArrowOpacity("ready", "ruling", "ready")).toBe(0.85);
    expect(strandArrowOpacity("ready", "dispute", "done")).toBe(0.85);
    expect(strandArrowOpacity("pending", "ruling", "live")).toBe(0.85);
    expect(strandArrowOpacity("attested", "dispute", "done")).toBe(1);
    expect(strandArrowOpacity("fail", "dispute", "fail")).toBe(1);
  });
});

describe("strandLabel", () => {
  it("shows a name of up to LABEL_MAX characters in full and cuts a longer one with an ellipsis", () => {
    expect(LABEL_MAX).toBe(11);
    expect(strandLabel("layer-zero")).toBe("layer-zero");
    expect(strandLabel("Wormhole V2")).toBe("Wormhole V2");
    expect(strandLabel("Chainlink CCIPv2")).toBe("Chainlink…");
    expect(strandLabel("Hyperlane Bridge")).toBe("Hyperlane…");
    for (const name of ["Chainlink CCIPv2", "abcdefghijklmnopqrstuvwxyz"]) expect(strandLabel(name).length).toBeLessThanOrEqual(LABEL_MAX);
  });
});

describe("travelOrder", () => {
  it("names every stop in the order of travel, with the titles the circuit shows", () => {
    const model = (label: string) => CASES.find(([l]) => l === label)![1];
    expect(travelOrder(model("sent, request leg live"))).toBe(
      "In order: the bulb, Request sent, the oracles, Delivered, Decision, Decision returning, the oracles, Bulb updated, and back to the bulb.",
    );
    expect(travelOrder(model("failure returned, request closed"))).toContain("Case not opened, Failure returning, the oracles, Request closed");
    expect(travelOrder(model("preview, idle"))).toContain("the bulb, Send request, the oracles, Court receives request");
  });
});
