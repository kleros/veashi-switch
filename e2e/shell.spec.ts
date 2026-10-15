import { expect, test } from "@playwright/test";
import {
  attachScreenshot,
  connectTestWallet,
  expectNoWrap,
  expectPlainText,
  goToStep,
  quoteReady,
  sendAndConfirm,
  showSteps,
  showCircuit,
  trackUntilCourt,
} from "./helpers";

test("[scenario:track-help] How it works opens from the shell, explains the stages and terms, closes with Escape", async ({
  page,
}, testInfo) => {
  await page.goto("/track");
  const open = page.getByRole("button", { name: "How it works" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "How a switch request works" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("help-stages").locator("li")).toHaveCount(4);
  for (const stage of ["Send the request.", "Oracles carry it to the court.", "The court decides.", "The decision comes back"])
    await expect(dialog).toContainText(stage);
  for (const term of ["Oracle", "Agreement needed", "Automatic relay service", "Court case", "Request fee"])
    await expect(dialog.getByTestId("help-terms").getByText(term, { exact: true })).toBeVisible();
  const text = await dialog.innerText();
  for (const re of [/keeper/i, /HomeGateway/i, /Higher is safer/i, /On \(1\)/i, /Off \(2\)/i, /You send one transaction/i, /Your part is done/i])
    expect(text).not.toMatch(re);
  await attachScreenshot(page, testInfo, "track-help");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test("[scenario:track-simulate-court] the status panel above the circuit asks you to simulate the court decision", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await connectTestWallet(page);
  const id = await sendAndConfirm(page);
  await trackUntilCourt(page, id);

  const now = page.getByTestId("now");
  await expect(now).toContainText("Your turn: simulate the court decision");
  await expect(now).toContainText("Local demo");
  // The status/action card sits above Progress (steps or circuit), which sits beside the request summary.
  const nowBox = (await now.boundingBox())!;
  const progressBox = (await page.getByTestId("progress").boundingBox())!;
  expect(nowBox.y + nowBox.height).toBeLessThanOrEqual(progressBox.y);
  // Equal weight: the same component, variant and size.
  const on = page.getByRole("button", { name: "Decide On" });
  const off = page.getByRole("button", { name: "Decide Off" });
  await expect(on).toBeEnabled();
  expect(await on.getAttribute("class")).toBe(await off.getAttribute("class"));
  const onBox = (await on.boundingBox())!;
  const offBox = (await off.boundingBox())!;
  expect(Math.abs(onBox.width - offBox.width)).toBeLessThan(2);
  expect(Math.abs(onBox.height - offBox.height)).toBeLessThan(2);
  await expect(page.locator("body")).not.toContainText("Waiting for jurors");
  await expect(page.locator("body")).not.toContainText("Who acts next");
  await expectPlainText(page, "Track at court arrival");
  await attachScreenshot(page, testInfo, "track-simulate-court");

  await on.click();
  await expect(now).toContainText("Decision submitted. Waiting for return delivery…");
  await expect(on).toHaveCount(0);
  await expectPlainText(page, "Track after the decision");
  await expect(page.getByTestId("track-stage")).toHaveAttribute("data-stage", "switched", { timeout: 120_000 });
});

test("[scenario:track-mobile-bulb] at 375 px the bulb, the status and the next action are in view; the lifecycle is a list", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await connectTestWallet(page);
  const id = await sendAndConfirm(page);
  await trackUntilCourtMobile(page, id);

  const inView = async (testId: string, what: string) => {
    const box = await page.getByTestId(testId).first().boundingBox();
    expect(box, `${what} has a box`).not.toBeNull();
    expect(box!.x, `${what} left`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${what} right`).toBeLessThanOrEqual(375);
    expect(box!.y, `${what} top`).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, `${what} bottom`).toBeLessThanOrEqual(812);
  };
  await page.evaluate(() => window.scrollTo(0, 0));
  await inView("bulb", "bulb");
  await inView("now-title", "status");
  await expect(page.getByTestId("now")).toContainText("Your turn: simulate the court decision");
  for (const name of ["Decide On", "Decide Off"]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.y + box.height, `${name} is in view`).toBeLessThanOrEqual(812);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // Progress defaults to Steps, a vertical list of the six stages; the SVG waits behind "Circuit".
  await expect(page.getByTestId("toggle-steps")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("lifecycle-summary")).toBeVisible();
  await expect(page.getByTestId("event-log").locator(":scope > li")).toHaveCount(6);
  await expect(page.getByTestId("circuit")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // Touch targets: icon buttons, the full-circuit toggle, the copy buttons and the oracle rows are 44 px or more.
  const small: string[] = [];
  for (const sel of ["button:visible"]) {
    for (const el of await page.locator(sel).all()) {
      const b = await el.boundingBox();
      if (b && (b.height < 43.5 || b.width < 43.5)) small.push(`${sel} ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
  }
  expect(small, "targets under 44 px").toEqual([]);
  await attachScreenshot(page, testInfo, "track-mobile-bulb");

  await showCircuit(page);
  await expect(page.getByTestId("circuit")).toBeVisible();
  await expect(page.getByRole("button", { name: "Scroll the circuit right" })).toBeVisible();
  const scroll = page.getByTestId("circuit-scroll");
  expect(await scroll.evaluate((el) => el.scrollLeft)).toBe(0); // starts at the bulb
  await page.getByRole("button", { name: "Scroll the circuit right" }).click();
  await expect.poll(async () => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Decide On" }).click();
  await expect(page.getByTestId("track-stage")).toHaveAttribute("data-stage", "switched", { timeout: 120_000 });
  await expect(page.getByTestId("bulb")).toHaveAttribute("data-state", "on");
  await expectPlainText(page, "Track at 375 px");
});

async function trackUntilCourtMobile(page: import("@playwright/test").Page, id: string) {
  await page.getByRole("link", { name: "Track request" }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${id}$`));
  await expect(page.getByTestId("now")).toContainText("Your turn: simulate the court decision", { timeout: 120_000 });
}

// Phone width, both themes and reduced motion.
test("layout at 375 px in dark and light, the circuit scrolls sideways, the bulb stays under reduced motion", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await showCircuit(page);
  await expect(page.getByText("Use the arrows or swipe to follow the whole circuit.")).toBeVisible();
  const scroll = page.getByTestId("circuit-scroll");
  const overflow = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(overflow.sw).toBeGreaterThan(overflow.cw);
  // The page itself does not scroll sideways; only the circuit does.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath("layout-375-dark.png"), fullPage: true });
  await testInfo.attach("layout-375-dark", { path: testInfo.outputPath("layout-375-dark.png"), contentType: "image/png" });

  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: testInfo.outputPath("layout-375-light.png"), fullPage: true });
  await testInfo.attach("layout-375-light", { path: testInfo.outputPath("layout-375-light.png"), contentType: "image/png" });

  // Reduced motion: a waiting bulb's filament does not flicker and the strands do not pulse.
  const anim = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="circuit-bulb"]')!;
    g.setAttribute("class", "bulb is-waiting");
    const f = g.querySelector(".bulb-filament")!;
    return getComputedStyle(f).animationName;
  });
  expect(anim).toBe("none");
});

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Each of the six stage titles appears once: as exact element text and as a whole phrase in the page text. */
async function expectStageTitlesOnce(page: import("@playwright/test").Page, label: string) {
  await showSteps(page);
  const titles = await page.getByTestId("stage-title").allTextContents();
  expect(titles, `${label}: six stages`).toHaveLength(6);
  const text = await page.evaluate(() => document.body.innerText);
  for (const t of titles) {
    await expect(page.getByText(t, { exact: true }), `${label}: "${t}" as element text`).toHaveCount(1);
    const hits = text.match(new RegExp(`(^|\\W)${escapeRe(t)}(?=$|\\W)`, "g")) ?? [];
    expect(hits.length, `${label}: "${t}" in the page text`).toBe(1);
  }
  await expect(page.getByRole("heading", { name: /event log/i })).toHaveCount(0);
}

test("[scenario:track-layout] the new Track layout: nothing under the bar, one stage list, one find panel, summary below progress", async ({
  page,
}, testInfo) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await connectTestWallet(page);
  const first = await sendAndConfirm(page);
  await page.getByRole("button", { name: "Start a new request" }).click();
  await goToStep(page, 3);
  await quoteReady(page);
  const second = await sendAndConfirm(page);

  // Open the newer request from the confirmation (the wallet stays connected).
  await page.getByRole("link", { name: "Track request" }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${second}$`));
  await expect(page.getByTestId("track-title")).toHaveText(`Request #${second}`);
  const barBottom = async () => {
    const b = (await page.locator("header").first().boundingBox())!;
    return b.y + b.height;
  };
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const headline = (await page.getByTestId("now-title").boundingBox())!;
  expect(headline.y).toBeGreaterThanOrEqual(await barBottom());

  // One panel finds or switches requests.
  await page.getByRole("button", { name: "Find or switch request" }).click();
  await expect(page.locator("input#open-id")).toBeVisible();
  await expect(page.getByTestId("my-requests")).toContainText(`Request #${first}`);
  await expect(page.getByTestId("my-requests")).toContainText(`Request #${second}`);
  await page.getByTestId(`request-option-${first}`).click();
  await expect(page).toHaveURL(new RegExp(`/track/${first}$`));
  await expect(page.getByTestId("track-title")).toHaveText(`Request #${first}`);
  await expect(page.locator("input#open-id")).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // At court arrival: the stage titles once, the card above Progress, the summary to its right.
  await expect(page.getByTestId("now")).toContainText("Your turn: simulate the court decision", { timeout: 120_000 });
  await expectStageTitlesOnce(page, "court arrival");
  // One column: Progress under the card, the summary under Progress, all on the same edges.
  const card = (await page.getByTestId("now").boundingBox())!;
  const progress = (await page.getByTestId("progress").boundingBox())!;
  const summary = (await page.getByTestId("dispute-record").boundingBox())!;
  expect(progress.y).toBeGreaterThanOrEqual(card.y + card.height - 1);
  expect(summary.y).toBeGreaterThanOrEqual(progress.y + progress.height - 1);
  expect(Math.abs(progress.x - card.x)).toBeLessThan(2);
  expect(Math.abs(progress.width - card.width)).toBeLessThan(2);
  await attachScreenshot(page, testInfo, "track-layout");

  await page.getByRole("button", { name: "Decide On" }).click();
  await expect(page.getByTestId("track-stage")).toHaveAttribute("data-stage", "switched", { timeout: 120_000 });
  await expect(page.getByTestId("bulb")).toHaveAttribute("data-state", /^(on|off)$/, { timeout: 60_000 });
  await expectStageTitlesOnce(page, "after the bulb updated");

  // The fake setup keeps its requests in memory and loses them on a reload; it seeds request 1 (ruled On) for this.
  const res = await page.request.get("/devnet.json");
  const fake = !res.ok() || !(res.headers()["content-type"] ?? "").includes("json");
  const target = fake ? "1" : first;

  // Steps or Circuit: the choice survives a reload.
  await page.getByTestId("toggle-circuit").click();
  await expect(page.getByTestId("circuit")).toBeVisible();
  await page.goto(`/track/${target}`);
  await expect(page.getByTestId("toggle-circuit")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("circuit")).toBeVisible();
  await showSteps(page);

  // The same layout at phone, tablet and desktop widths: nothing under the bar, no wrapped control text, no sideways scroll.
  for (const [width, height] of [
    [1440, 900],
    [768, 900],
    [390, 844],
    [375, 812],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/track/${target}`);
    await expect(page.getByTestId("track-title")).toHaveText(`Request #${target}`);
    expect(await page.evaluate(() => window.scrollY), `scrollY at ${width} px`).toBe(0);
    const h = (await page.getByTestId("now-title").boundingBox())!;
    expect(h.y, `status headline below the bar at ${width} px`).toBeGreaterThanOrEqual(await barBottom());
    await expectNoWrap(page, `Track at ${width} px`);
    await page.getByRole("button", { name: "Find or switch request" }).click();
    await expect(page.locator("input#open-id")).toBeVisible();
    await expectNoWrap(page, `Find panel at ${width} px`);
    await page.keyboard.press("Escape");
  }
});
