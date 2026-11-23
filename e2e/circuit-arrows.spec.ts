import { expect, test, type Page } from "@playwright/test";
import { attachScreenshot, connectTestWallet, sendAndConfirm, showCircuit } from "./helpers";

// Every connector of the circuit carries an arrow that points the way the message moves: bulb → Request sent →
// oracle strands → junction → Delivered → Decision → Decision returning → oracle strands → junction → Bulb updated →
// bulb. Checked on the rendered SVG, not on the component's own attributes: each chevron's tip and tail are read from
// its drawn geometry, its connector's path from the browser, and the route below is the test's own.

type Dir = "right" | "left" | "down" | "up";
const WIRES: Record<string, [string, string, Dir]> = {
  "bulb-request": ["bulb", "foreignOut", "right"],
  "junction-delivered": ["junction-dispute", "homeIn", "right"],
  "delivered-court": ["homeIn", "court", "down"],
  "court-returning": ["court", "homeOut", "left"],
  "junction-updated": ["junction-ruling", "foreignIn", "left"],
  "updated-bulb": ["foreignIn", "bulb", "up"],
};
const LEGS: Record<string, [string, string, Dir]> = {
  dispute: ["foreignOut", "junction-dispute", "right"],
  ruling: ["homeOut", "junction-ruling", "left"],
};

async function isFake(page: Page) {
  const res = await page.request.get("/devnet.json");
  return !res.ok() || !(res.headers()["content-type"] ?? "").includes("json");
}

/** Reads the circuit and returns what is wrong with its arrows (nothing: an empty list) and how many it checked. */
async function arrowProblems(page: Page): Promise<{ problems: string[]; checked: string[] }> {
  return page.evaluate(
    ({ wires, legs }) => {
      const svg = document.querySelector<SVGSVGElement>('svg[data-testid="circuit"]')!;
      const inv = svg.getScreenCTM()!.inverse();
      type Pt = { x: number; y: number };
      type Box = { x0: number; y0: number; x1: number; y1: number };
      const toUser = (el: SVGGraphicsElement, x: number, y: number): Pt =>
        new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!).matrixTransform(inv);
      const boxOf = (el: SVGGraphicsElement, pad = 0): Box => {
        const b = el.getBBox();
        const pts = [
          toUser(el, b.x, b.y),
          toUser(el, b.x + b.width, b.y),
          toUser(el, b.x, b.y + b.height),
          toUser(el, b.x + b.width, b.y + b.height),
        ];
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
      };
      const distBox = (p: Pt, b: Box) => Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));
      const q = <T extends Element>(sel: string) => svg.querySelector<T>(sel);
      const qa = <T extends Element>(sel: string) => Array.from(svg.querySelectorAll<T>(sel));
      // where the message is: a node's box, a junction's ring, the bulb's glass and screw rings
      const stopBoxes = (stop: string): Box[] => {
        if (stop === "bulb") return qa<SVGGraphicsElement>('[data-testid="circuit-bulb"] .bulb-glass, [data-testid="circuit-bulb"] .bulb-screw').map((e) => boxOf(e));
        if (stop.startsWith("junction-")) return [boxOf(q<SVGGraphicsElement>(`[data-testid="${stop}"] circle.junction`)!)];
        return [boxOf(q<SVGGraphicsElement>(`[data-testid="node-${stop}"] rect.node`)!)];
      };
      const nearest = (p: Pt, boxes: Box[]) => Math.min(...boxes.map((b) => distBox(p, b)));
      const unit = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] } as const;

      // The theme's colours as the browser computes them (rgb), read through a probe: a wire's colour by its state,
      // and its arrow's (an idle arrow is a stronger shade than its wire, so it still reads).
      const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
      svg.appendChild(probe);
      const resolve = (v: string) => {
        probe.style.stroke = v;
        return getComputedStyle(probe).stroke;
      };
      const wireColour = { idle: resolve("var(--wire-idle)"), active: resolve("var(--purple-2)"), done: resolve("var(--ok)"), fail: resolve("var(--err)") };
      const arrowColour = { ...wireColour, idle: resolve("var(--arrow-idle)") };
      probe.remove();
      // the card the circuit is drawn on: the first ancestor with a background
      let ground = "rgb(255, 255, 255)";
      for (let el: Element | null = svg; el; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== "transparent" && !/rgba\(.*, 0\)$/.test(bg)) {
          ground = bg;
          break;
        }
      }
      const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = (c: number[]) => {
        const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      /** The contrast of a stroke at an opacity on the card. */
      const contrast = (stroke: string, opacity: number) => {
        const bg = rgb(ground);
        const fg = rgb(stroke).map((v, i) => v * opacity + bg[i] * (1 - opacity));
        const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };

      const problems: string[] = [];
      const checked: string[] = [];
      const expected: { id: string; from: string; to: string; dir: keyof typeof unit; kind: "wire" | "strand"; path: SVGPathElement | null }[] = [];
      for (const [id, [from, to, dir]] of Object.entries(wires))
        expected.push({ id, from, to, dir, kind: "wire", path: q<SVGPathElement>(`[data-testid="wire-${id}"]`) });
      for (const [leg, [from, to, dir]] of Object.entries(legs)) {
        for (const g of qa<SVGGElement>(`[data-testid^="strand-${leg}-"]`)) {
          const id = g.dataset.testid!;
          const arrow = q(`[data-testid="arrow-${id}"]`);
          // an oracle that is not selected carries nothing, and its strand has no arrow
          if (g.dataset.state === "off") {
            if (arrow) problems.push(`${id} is off but has an arrow`);
            continue;
          }
          expected.push({ id, from, to, dir, kind: "strand", path: g.querySelector<SVGPathElement>("path.strand") });
        }
      }
      // until the oracles load there are no strands: not yet a circuit to check
      for (const leg of Object.keys(legs))
        if (!expected.some((e) => e.kind === "strand" && e.id.startsWith(`strand-${leg}-`))) problems.push(`no strand with an arrow on the ${leg} leg yet`);
      const arrows = qa<SVGPathElement>('[data-testid^="arrow-"]');
      if (arrows.length !== expected.length) problems.push(`${arrows.length} arrows for ${expected.length} connectors`);

      const arrowBoxes: { id: string; box: Box }[] = [];
      for (const e of expected) {
        const a = q<SVGPathElement>(`[data-testid="arrow-${e.id}"]`);
        if (!a || !e.path) {
          problems.push(`${e.id}: ${a ? "no path" : "no arrow"}`);
          continue;
        }
        // the chevron as drawn: M arm L tip L arm
        const n = a.getAttribute("d")!.match(/-?\d+(\.\d+)?/g)!.map(Number);
        const tip = toUser(a, n[2], n[3]);
        const tail = toUser(a, (n[0] + n[4]) / 2, (n[1] + n[5]) / 2);
        const hl = Math.hypot(tip.x - tail.x, tip.y - tail.y);
        const h = { x: (tip.x - tail.x) / hl, y: (tip.y - tail.y) / hl };
        const [wx, wy] = unit[e.dir];
        const along = h.x * wx + h.y * wy;
        if (along < (e.kind === "wire" ? 0.999 : 0.7))
          problems.push(`${e.id}: points (${h.x.toFixed(2)}, ${h.y.toFixed(2)}) but the message moves ${e.dir}`);

        // the connector's path runs from where the message leaves to where it arrives
        const path = e.path;
        const len = path.getTotalLength();
        const at = (s: number) => {
          const p = path.getPointAtLength(Math.max(0, Math.min(len, s)));
          return toUser(path, p.x, p.y);
        };
        const src = stopBoxes(e.from);
        const dst = stopBoxes(e.to);
        if (nearest(at(0), src) > 2) problems.push(`${e.id}: its path does not start at ${e.from}`);
        if (nearest(at(len), dst) > 3) problems.push(`${e.id}: its path does not end at ${e.to}`);

        // the arrow sits on its path and along it
        let s0 = len;
        if (e.kind === "wire") {
          const end = at(len);
          if (Math.hypot(end.x - tip.x, end.y - tip.y) > 0.6) problems.push(`${e.id}: the tip is not at the end of the wire`);
        } else {
          let best = { s: 0, d: Infinity };
          for (let s = 0; s <= len; s += 0.25) {
            const p = at(s);
            const d = Math.hypot(p.x - tip.x, p.y - tip.y);
            if (d < best.d) best = { s, d };
          }
          if (best.d > 0.75) problems.push(`${e.id}: the tip is ${best.d.toFixed(2)} off its strand`);
          s0 = best.s;
        }
        const p0 = at(s0 - 1.5);
        const p1 = at(Math.min(len, s0 + 1.5) === s0 ? s0 : s0 + 1.5);
        const tl = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const tang = ((p1.x - p0.x) / tl) * h.x + ((p1.y - p0.y) / tl) * h.y;
        if (tang < 0.97) problems.push(`${e.id}: the arrow does not follow its path (${tang.toFixed(3)})`);
        if (!(nearest(tip, dst) < nearest(tail, dst))) problems.push(`${e.id}: does not point toward ${e.to}`);
        if (!(nearest(tip, src) > nearest(tail, src) || e.kind === "wire")) problems.push(`${e.id}: points back toward ${e.from}`);

        // its colour: a wire's arrow is in the colour of its wire's state, read from the wire as drawn; a strand's
        // arrow is in its strand's colour, never fainter than 0.85; solid, and at 3:1 or more on the card
        const ca = getComputedStyle(a);
        const cp = getComputedStyle(path);
        const opacity = Number(ca.opacity);
        let state = a.dataset.state;
        if (e.kind === "wire") {
          state = (Object.keys(wireColour) as (keyof typeof wireColour)[]).find((k) => wireColour[k] === cp.stroke);
          if (!state) problems.push(`${e.id}: the wire is ${cp.stroke}, no state's colour`);
          else if (ca.stroke !== arrowColour[state as keyof typeof arrowColour])
            problems.push(`${e.id}: arrow ${ca.stroke} on a ${state} wire (${arrowColour[state as keyof typeof arrowColour]} expected)`);
          if (opacity !== 1) problems.push(`${e.id}: arrow opacity ${opacity}`);
        } else {
          if (ca.stroke !== cp.stroke) problems.push(`${e.id}: arrow ${ca.stroke}, its strand ${cp.stroke}`);
          const want = Math.max(Number(cp.opacity), 0.85);
          if (Math.abs(opacity - want) > 0.001) problems.push(`${e.id}: arrow opacity ${opacity}, ${want} expected (strand ${cp.opacity})`);
        }
        const cr = contrast(ca.stroke, opacity);
        if (cr < 3) problems.push(`${e.id}: arrow contrast ${cr.toFixed(2)}:1 on ${ground}`);
        if (ca.strokeDasharray !== "none") problems.push(`${e.id}: the arrow is dashed`);
        if (ca.display === "none" || ca.visibility !== "visible") problems.push(`${e.id}: the arrow is hidden`);
        checked.push(`${e.id}:${e.dir}:${state}`);
        arrowBoxes.push({ id: e.id, box: boxOf(a, 1) });
      }

      // nothing is covered: node boxes, status dots, junctions, every text, the oracle dots and checks, the bulb
      const obstacles: { what: string; box: Box }[] = [
        ...qa<SVGGraphicsElement>("rect.node").map((e) => ({ what: "a node box", box: boxOf(e, 0.75) })),
        ...qa<SVGGraphicsElement>('[data-testid^="node-"] > g > circle').map((e) => ({ what: "a status dot", box: boxOf(e, 1) })),
        ...qa<SVGGraphicsElement>("circle.junction").map((e) => ({ what: "a junction", box: boxOf(e, 1) })),
        ...qa<SVGTextElement>("text").map((e) => ({ what: `text "${e.textContent}"`, box: boxOf(e) })),
        ...qa<SVGGraphicsElement>('[data-testid^="strand-"] g circle, [data-testid^="strand-"] g path').map((e) => ({ what: "an oracle label mark", box: boxOf(e, 1) })),
        ...qa<SVGGraphicsElement>('[data-testid="circuit-bulb"] .bulb-glass, [data-testid="circuit-bulb"] .bulb-screw').map((e) => ({ what: "the bulb", box: boxOf(e, 1) })),
      ];
      const hit = (a: Box, b: Box) => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1;
      for (const { id, box } of arrowBoxes) {
        for (const o of obstacles) if (hit(box, o.box)) problems.push(`${id}: overlaps ${o.what}`);
        for (const o of arrowBoxes) if (o.id !== id && hit(box, o.box)) problems.push(`${id}: overlaps arrow ${o.id}`);
      }
      return { problems, checked };
    },
    { wires: WIRES, legs: LEGS },
  );
}

/** Waits for the arrows to settle (state colours fade) and expects none wrong; returns the arrows checked. */
async function expectArrows(page: Page, label: string): Promise<string[]> {
  let last: { problems: string[]; checked: string[] } = { problems: [], checked: [] };
  await expect
    .poll(async () => (last = await arrowProblems(page)).problems, { message: `${label}: arrow problems`, timeout: 10_000 })
    .toEqual([]);
  return last.checked;
}

const stateOf = (checked: string[], id: string) => checked.find((c) => c.startsWith(`${id}:`))?.split(":")[2];

/** In a high-contrast (forced colours) theme: the arrows not drawn in the system's text colour at full opacity. */
async function forcedColourMisses(page: Page): Promise<{ arrows: number; misses: string[] }> {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('svg[data-testid="circuit"]')!;
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(probe);
    probe.style.stroke = "CanvasText";
    const text = getComputedStyle(probe).stroke;
    probe.remove();
    const arrows = Array.from(svg.querySelectorAll<SVGPathElement>('[data-testid^="arrow-"]'));
    const misses = arrows
      .map((a) => ({ id: a.dataset.testid, cs: getComputedStyle(a) }))
      .filter(({ cs }) => cs.stroke !== text || cs.opacity !== "1")
      .map(({ id, cs }) => `${id}: ${cs.stroke} at ${cs.opacity}, ${text} expected`);
    return { arrows: arrows.length, misses };
  });
}

test("[scenario:circuit-arrows] every connector's arrow points the way the message moves: idle, in progress and done", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const fake = await isFake(page);

  // Idle: the Request page's preview, nothing sent, in both themes.
  await page.goto(fake ? "/?step=2500" : "/");
  await expect(page.getByTestId("circuit").first()).toBeVisible();
  const idle = await expectArrows(page, "preview");
  for (const id of Object.keys(WIRES)) expect(stateOf(idle, id), `preview: ${id}`).toBe("idle");
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectArrows(page, "preview, light");
  // High contrast: every arrow in the system's text colour, whatever the app's theme.
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme) await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.emulateMedia({ forcedColors: "active" });
    await expect.poll(async () => (await forcedColourMisses(page)).misses, { message: `forced colours, ${theme}` }).toEqual([]);
    expect((await forcedColourMisses(page)).arrows).toBeGreaterThanOrEqual(6);
    await page.emulateMedia({ forcedColors: "none" });
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("circuit").first()).toHaveAttribute("aria-label", /In order: the bulb, Send request, the oracles, .*, and back to the bulb\.$/);

  // In progress: the request leg relaying.
  await connectTestWallet(page);
  const id = await sendAndConfirm(page);
  await page.getByRole("link", { name: "Track request" }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${id}$`));
  await showCircuit(page);
  // on the devnet the relayer may finish the leg before Track opens: either is a sent request
  await expect(page.getByTestId("leg-dispute")).toHaveAttribute("data-status", /^(live|done)$/);
  const live = await expectArrows(page, "request leg sent");
  expect(stateOf(live, "bulb-request")).toBe("done");
  expect(stateOf(live, "updated-bulb")).toBe("idle");
  await expect(page.getByTestId("circuit")).toHaveAttribute(
    "aria-label",
    /In order: the bulb, Request sent, the oracles, Delivered, Decision, Decision returning, the oracles, Bulb updated, and back to the bulb\.$/,
  );

  // In progress: the court has the case.
  await expect(page.getByRole("button", { name: "Decide On" })).toBeVisible({ timeout: 120_000 });
  const court = await expectArrows(page, "court open");
  expect(stateOf(court, "delivered-court")).toBe("done");
  expect(stateOf(court, "court-returning")).toBe("idle");

  // In progress: the decision leg relaying.
  await page.getByRole("button", { name: "Decide On" }).click();
  await showCircuit(page);
  await expect(page.getByTestId("leg-ruling")).toHaveAttribute("data-status", /^(live|done)$/, { timeout: 120_000 });
  const back = await expectArrows(page, "decision leg sent");
  expect(stateOf(back, "court-returning")).toBe("done");

  // Done: the bulb is updated and every wire's arrow is done.
  await expect(page.getByTestId("node-foreignIn")).toHaveAttribute("data-state", "done", { timeout: 120_000 });
  await showCircuit(page);
  const done = await expectArrows(page, "done");
  for (const w of Object.keys(WIRES)) expect(stateOf(done, w), `done: ${w}`).toBe("done");
  await attachScreenshot(page, testInfo, "circuit-arrows");
});

test("arrows on a paused delivery and on a case the court could not open, back to the closed request", async ({ page }) => {
  test.skip(!(await isFake(page)), "fake setup only");
  test.setTimeout(180_000);

  // Paused: the request leg stops after one report.
  await page.goto("/?stall=1&step=300");
  await connectTestWallet(page);
  await sendAndConfirm(page);
  await page.getByRole("link", { name: "Track request" }).click();
  await showCircuit(page);
  await expect(page.getByTestId("leg-dispute")).toHaveAttribute("data-status", "fail");
  await expectArrows(page, "paused");

  // The court cannot open the case: the failure goes back along the same circuit.
  await page.goto("/?creation=fail&step=300&window=3000");
  await connectTestWallet(page);
  await sendAndConfirm(page);
  await page.getByRole("link", { name: "Track request" }).click();
  await showCircuit(page);
  await expect(page.getByTestId("node-court")).toHaveAttribute("data-state", "fail", { timeout: 60_000 });
  const stuck = await expectArrows(page, "court cannot open the case");
  expect(stateOf(stuck, "court-returning")).toBe("fail");
  await page.getByTestId("act-send-failure").getByRole("button", { name: "Send the failure back" }).click();
  await showCircuit(page);
  await expect(page.getByTestId("node-foreignIn")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  await expect(page.getByTestId("circuit")).toHaveAttribute("aria-label", /Case not opened, Failure returning, the oracles, Request closed, and back/);
  await expectArrows(page, "failure returned");
});
