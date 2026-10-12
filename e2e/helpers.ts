import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { parseUnits } from "viem";

/** The patterns no default view may show (the same list as src/components/copy.ts FORBIDDEN_TEXT). */
export const FORBIDDEN: RegExp[] = [
  /Reporter/i,
  /Adapter/i,
  /keeper/i,
  /Kleros ops/i,
  /LightbulbSwitched/i,
  /requestSwitch/i,
  /onMessage/i,
  /createDispute/i,
  /Yaru/i,
  /HomeGateway/i,
  /ForeignGateway/i,
  /KlerosCoreRuler/i,
  /Gateway default/i,
  /Choose my own/i,
  /Waiting for jurors/i,
  /Stuck/i,
  /Nothing was charged/i,
  /Foreign dispute/i,
  /Home dispute/i,
  /On \(1\)/i,
  /Off \(2\)/i,
  /Higher is safer/i,
  /Reading /i,
  /Who acts next/i,
  /about 3 days/i,
  /Base \(devnet\)/i,
  /Arbitrum One/i,
];

/** The page's visible text, with "Technical details" closed, must match none of the forbidden patterns. */
export async function expectPlainText(page: Page, label = "page") {
  const text = await page.evaluate(() => document.body.innerText);
  for (const re of FORBIDDEN) expect(text, `${label} shows ${re}`).not.toMatch(re);
}

export const routeSection = (page: Page) => page.getByRole("region", { name: "Network route", exact: true });
export const oraclesSection = (page: Page) => page.getByRole("region", { name: "Choose oracles", exact: true });
export const paySection = (page: Page) => page.getByRole("region", { name: "Pay and send", exact: true });

/** Moves the Request carousel to step `n` with Back or Continue (the only way: inactive steps are not rendered). */
export async function goToStep(page: Page, n: 1 | 2 | 3) {
  const count = page.getByTestId("step-count");
  for (let guard = 0; guard < 6; guard++) {
    const m = /Step (\d) of 3/.exec((await count.textContent()) ?? "");
    const cur = Number(m?.[1]);
    if (cur === n) break;
    const btn = page.getByTestId(cur < n ? "continue" : "back");
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(count).not.toHaveText(`Step ${cur} of 3`);
  }
  await expect(count).toHaveText(`Step ${n} of 3`);
}

/** Track's Progress shows the six-stage timeline (log-*, report-*). Does nothing where there is no switch. */
export async function showSteps(page: Page) {
  const btn = page.getByTestId("toggle-steps");
  if ((await btn.count()) === 0) return;
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
}

/** Track's Progress shows the SVG circuit (node-tx-*, circuit-bulb, junction-*). On Request the preview already draws it. */
export async function showCircuit(page: Page) {
  const btn = page.getByTestId("toggle-circuit");
  if ((await btn.count()) === 0) return;
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("circuit").first()).toBeVisible();
}

/**
 * Buttons, selects and labels must not wrap their text: a wrap is a visible one whose text lies on lines whose tops
 * differ by more than half a line-height. Also: no horizontal page scroll.
 */
export async function expectNoWrap(page: Page, label: string) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("button, select, label"))) {
      const box = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || box.width < 2 || box.height < 2) continue;
      if (el.closest("[inert], dialog:not([open]), [hidden]")) continue;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      const tops: number[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim()) continue;
        const pr = n.parentElement!.getBoundingClientRect();
        if (pr.width < 2 || pr.height < 2) continue; // visually hidden text
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) tops.push(r.top);
      }
      if (tops.length && Math.max(...tops) - Math.min(...tops) > lh / 2)
        out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`);
    }
    return out;
  });
  expect(bad, `${label}: text wraps in`).toEqual([]);
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw[0], `${label}: horizontal page scroll`).toBeLessThanOrEqual(sw[1]);
}

/** Connects the devnet's test wallet (the anvil dev account) and makes sure it sits on the foreign chain. */
export async function connectTestWallet(page: Page) {
  await goToStep(page, 1);
  const state = page.getByTestId("wallet-state");
  await expect(state).toBeVisible();
  const useTest = routeSection(page).getByRole("button", { name: "Use test wallet" });
  if (await useTest.isVisible()) await useTest.click();
  const switchChain = routeSection(page).getByTestId("switch-chain");
  await expect(state.filter({ hasText: "Wallet on Base-like local devnet" }).or(switchChain).first()).toBeVisible();
  if (await switchChain.isVisible()) await switchChain.click();
  await expect(state).toHaveText("Wallet on Base-like local devnet");
}

/** The one screenshot a scenario test attaches, named for the verifier. */
export async function attachScreenshot(page: Page, testInfo: TestInfo, scenario: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  // Attached by path (not inline) so the JSON report points at a real PNG file.
  const path = testInfo.outputPath(`screenshot-${scenario}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(`screenshot:${scenario}`, { path, contentType: "image/png" });
}

export async function customizeSelection(page: Page) {
  await goToStep(page, 2);
  await oraclesSection(page).getByRole("button", { name: "Customize selection" }).click();
  await expect(oraclesSection(page).getByRole("checkbox").first()).toBeEnabled();
}

/** Waits until the quote for the current configuration is shown (the cost has a total). */
export async function quoteReady(page: Page) {
  await expect(page.getByTestId("cost-total")).toBeVisible();
}

const units = (text: string, decimals: number) => parseUnits(text.replace(/,/g, "").replace(/[^\d.]/g, ""), decimals);

/** The displayed cost rows must add up exactly to the displayed "Request fee". */
export async function expectRowsSumToTotal(page: Page, decimals: number) {
  const rows = page.locator('[data-testid="cost-jurors"], [data-testid^="cost-oracle-"], [data-testid="cost-other"]');
  let sum = 0n;
  for (const text of await rows.allTextContents()) sum += units(text, decimals);
  const total = units((await page.getByTestId("cost-total").textContent()) ?? "", decimals);
  expect(sum, "the displayed rows sum to the displayed Request fee").toBe(total);
}

/** Sends the request as configured and returns the request id from the confirmation. */
export async function sendAndConfirm(page: Page): Promise<string> {
  await goToStep(page, 3);
  const send = page.getByTestId("send");
  await expect(send).toBeEnabled();
  await send.click();
  const ok = page.getByTestId("request-success");
  await expect(ok).toBeVisible();
  const title = (await ok.getByRole("heading").textContent()) ?? "";
  const id = /Request #(\d+) sent/.exec(title)?.[1];
  expect(id, `request id in "${title}"`).toBeTruthy();
  await expect(page.getByTestId("request-tx")).toHaveText(/^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/);
  return id!;
}

/** From the confirmation to Track, with the dispute leg reporting oracle by oracle until the court has it. */
export async function trackUntilCourt(page: Page, id: string) {
  await page.getByRole("link", { name: "Track request" }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${id}$`));
  await expect(page.getByTestId("track-title")).toContainText(`Request #${id}`);
  await expect(page.getByTestId("toggle-circuit")).toBeVisible();
  await showCircuit(page);
  await expect(page.getByTestId("node-tx-foreignOut")).toHaveAttribute("data-hash", /^0x[0-9a-fA-F]{64}$/);
  const junction = page.getByTestId("junction-dispute");
  const k = Number(await junction.getAttribute("data-threshold"));
  expect(k).toBeGreaterThan(0);
  await showSteps(page);
  await expect
    .poll(async () => page.locator('[data-testid^="report-dispute-"][data-status="reported"]').count())
    .toBeGreaterThanOrEqual(k);
  await expect(page.getByTestId("log-dispute-received")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("home-dispute")).toContainText("#");
  await expect(page.getByTestId("toggle-circuit")).toBeVisible();
  await showCircuit(page);
  await expect(page.getByTestId("node-tx-homeIn")).toHaveAttribute("data-hash", /^0x[0-9a-fA-F]{64}$/);
  await expect(page.getByTestId("bulb")).toHaveAttribute("data-state", "waiting");
  return k;
}

/**
 * Follows a request on Track: the dispute leg reports oracle by oracle until the threshold, the court receives it,
 * the local demo decision is given, the decision leg reports and the bulb ends in `ruling`'s state.
 */
export async function followToRuling(page: Page, id: string, ruling: 1 | 2) {
  const k = await trackUntilCourt(page, id);
  const now = page.getByTestId("now");
  await expect(now).toContainText("Your turn: simulate the court decision");
  await page.getByRole("button", { name: ruling === 1 ? "Decide On" : "Decide Off" }).click();
  await expect(now).toContainText("Decision submitted. Waiting for return delivery…");
  await showSteps(page);
  await expect(page.getByTestId("log-ruled")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("ruling")).toHaveText(ruling === 1 ? "On" : "Off");

  await expect(page.getByTestId("track-stage")).toHaveAttribute("data-stage", "switched", { timeout: 120_000 });
  await expect
    .poll(async () => page.locator('[data-testid^="report-ruling-"][data-status="reported"]').count())
    .toBeGreaterThanOrEqual(k);
  await expect(page.getByTestId("bulb")).toHaveAttribute("data-state", ruling === 1 ? "on" : "off");
  await showCircuit(page);
  await expect(page.getByTestId("circuit-bulb")).toHaveAttribute("data-state", ruling === 1 ? "on" : "off");
  for (const node of ["foreignOut", "homeIn", "court", "homeOut", "foreignIn"])
    await expect(page.getByTestId(`node-tx-${node}`), `${node} shows its tx`).toHaveAttribute(
      "data-hash",
      /^0x[0-9a-fA-F]{64}$/,
    );
  // The court's decision dispatches inside one transaction: the dispatch node shows that same tx.
  const ruledHash = await page.getByTestId("node-tx-court").getAttribute("data-hash");
  await expect(page.getByTestId("node-tx-homeOut")).toHaveAttribute("data-hash", ruledHash!);
  await showSteps(page);
  await expect(page.getByTestId("log-switched")).toHaveAttribute("data-state", "done");
  await expect(now).toContainText(`Request complete · bulb set ${ruling === 1 ? "On" : "Off"}`);
}

/** Toggles a library Checkbox: its native input is visually hidden, so click the label that wraps it. */
export async function toggle(box: Locator) {
  await box.locator("xpath=..").click();
}

/** Delays every call to the local chains' RPC, to hold a quote or a transaction in flight. Returns the undo. */
export async function slowRpc(page: Page, ms: number): Promise<() => Promise<void>> {
  const res = await page.request.get("/devnet.json").catch(() => null);
  const env = res && res.ok() ? await res.json().catch(() => null) : null;
  if (!env) return async () => {}; // the fake build slows its quotes with ?quote=<ms> instead
  const handler = async (route: import("@playwright/test").Route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue().catch(() => {});
  };
  const urls = [env.foreign.rpcUrl, env.home.rpcUrl];
  for (const u of urls) await page.route(`${u}/**`, handler).catch(() => {});
  for (const u of urls) await page.route(u, handler);
  return async () => {
    for (const u of urls) {
      await page.unroute(u, handler);
      await page.unroute(`${u}/**`, handler).catch(() => {});
    }
  };
}
