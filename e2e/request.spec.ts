import { expect, test } from "@playwright/test";
import {
  attachScreenshot,
  connectTestWallet,
  customizeSelection,
  expectNoWrap,
  expectPlainText,
  expectRowsSumToTotal,
  followToRuling,
  goToStep,
  oraclesSection,
  paySection,
  quoteReady,
  routeSection,
  sendAndConfirm,
  showCircuit,
  showSteps,
  slowRpc,
  toggle,
} from "./helpers";

test("[scenario:request-validation] an agreement threshold above the oracles chosen blocks sending", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await connectTestWallet(page);
  await goToStep(page, 2);
  const section = oraclesSection(page);

  // Default mode is a read-only summary with a way to customize.
  const summary = page.getByTestId("selection-summary");
  await expect(summary).toContainText(/^Default selection · .+ · \d+ must agree/);
  await expect(section.getByRole("checkbox")).toHaveCount(0);
  await customizeSelection(page);

  const boxes = section.getByRole("checkbox");
  await expect(boxes).not.toHaveCount(0);
  const threshold = page.getByTestId("threshold");
  const more = page.getByRole("button", { name: "More oracles must agree" });
  const fewer = page.getByRole("button", { name: "Fewer oracles must agree" });
  const next = page.getByTestId("continue");
  const error = page.getByTestId("selection-error");

  // Every oracle the agreement needs: k = n.
  const checked = section.getByRole("checkbox", { checked: true });
  const n = await checked.count();
  expect(n).toBeGreaterThanOrEqual(2);
  while (await more.isEnabled()) await more.click();
  await expect(threshold).toHaveText(`${n} of ${n} must agree`);
  await expect(error).toBeHidden();
  await expect(next).toBeEnabled();

  // Drop one oracle: n - 1 chosen, n must agree. The correction is explained beside the control; Continue waits.
  await toggle(checked.last());
  await expect(threshold).toHaveText(`${n} required · ${n - 1} selected`);
  await expect(error).toBeVisible();
  await expect(error).toContainText(`You require ${n} oracles to agree, but only ${n - 1}`);
  await expect(error).not.toContainText(/InvalidThreshold|ForeignGateway/);
  await expect(next).toBeDisabled();
  await expect(page.getByTestId("continue-reason")).toContainText(`You require ${n} oracles to agree`);
  await expect(page.getByTestId("send")).toHaveCount(0);
  await expect(page.getByTestId("cost")).toBeHidden();
  await attachScreenshot(page, testInfo, "request-validation");

  // Fix it: Continue is enabled, and on step 3 the quote appears and send is enabled.
  await fewer.click();
  await expect(threshold).toHaveText(`${n - 1} of ${n - 1} must agree`);
  await expect(error).toBeHidden();
  await expect(next).toBeEnabled();
  await next.click();
  await quoteReady(page);
  await expect(page.getByTestId("cost-total")).toContainText("ETH");
  await expect(page.getByTestId("send")).toBeEnabled();

  // No oracle at all: no "2 of 0", the threshold controls give way to a prompt with a way back.
  await page.getByTestId("edit-oracles").click();
  const left = section.getByRole("checkbox", { checked: true });
  while ((await left.count()) > 0) await toggle(left.first());
  await expect(section.getByText("Choose an oracle first").first()).toBeVisible();
  await expect(threshold).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More oracles must agree" })).toHaveCount(0);
  await expect(next).toBeDisabled();
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/\b\d+ of 0\b|\d+\/0\b/);
  await expect(page.getByTestId("junction-dispute")).toContainText("–");
  await section.getByRole("button", { name: "Use default selection" }).click();
  await expect(summary).toContainText("Default selection");
  await goToStep(page, 3);
  await quoteReady(page);
  await expect(page.getByTestId("send")).toBeEnabled();
});

test("[scenario:request-send-on] default selection paid in ETH, followed on Track to the decision On and a lit bulb", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await connectTestWallet(page);
  await goToStep(page, 2);
  await expect(page.getByTestId("selection-summary")).toContainText(/^Default selection · .+ · \d+ must agree/);
  await expect(page.getByRole("heading", { name: "Route preview" })).toBeVisible();
  await goToStep(page, 3);
  await expect(page.getByRole("radio", { name: "ETH" })).toBeChecked();

  // The cost breakdown: juror fees, one fee per default oracle, the Request fee; rows add up.
  await quoteReady(page);
  await expect(page.getByTestId("cost-jurors")).toBeVisible();
  await expect(page.locator('[data-testid^="cost-oracle-"]')).not.toHaveCount(0);
  await expect(page.getByTestId("cost-total")).toContainText("ETH");
  await expect(paySection(page)).toContainText("Network gas extra, paid in local ETH");
  await expectRowsSumToTotal(page, 18);

  const id = await sendAndConfirm(page);
  // Request is a preview: confirmation says "Request #N sent", offers Track request, and promises no live updates.
  const ok = page.getByTestId("request-success");
  await expect(ok).toContainText(`Request #${id} sent`);
  await expect(ok).toContainText("Open Track to follow this request.");
  await expect(page.getByRole("link", { name: "Track request" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/shows each step as it happens|Follow dispute/);
  await expectPlainText(page, "Request after sending");

  await followToRuling(page, id, 1);

  // The top-bar route pill is a link on Track too and lands on the tracked request's route summary.
  await page.getByTestId("route").click();
  await expect(page).toHaveURL(/#track-route$/);
  await expect(page.getByTestId("record-route")).toBeInViewport();

  // Plain default view: labels, observed-at times, no implementation words.
  await expectPlainText(page, "Track");
  await showSteps(page);
  const log = page.getByTestId("event-log");
  await expect(log).toContainText(/Observed at \d\d:\d\d:\d\d|Completed before this page opened/);
  await expect(page.getByTestId("dispute-record")).toContainText("Request ID");
  await expect(page.getByTestId("dispute-record")).toContainText("Court case ID");
  await page.getByRole("button", { name: "Find or switch request" }).click();
  await expect(page.locator('input#open-id')).toBeVisible();
  await expect(page.getByText("Request ID", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('input#open-id')).toBeHidden();

  // Technical details hold the transaction hashes, the contracts and the calls.
  await page.getByRole("button", { name: "Technical details" }).click();
  const tech = page.getByTestId("technical-details");
  await expect(tech).toContainText("ForeignGateway");
  await expect(tech).toContainText("oracle id");
  await expect(tech.getByTestId("tech-tx")).not.toHaveCount(0);
  for (const stage of ["submitted", "dispute-received", "ruled", "switched"])
    await expect(tech.locator(`[data-testid="tech-tx"][data-stage="${stage}"]`).first()).toHaveAttribute(
      "data-hash",
      /^0x[0-9a-fA-F]{64}$/,
    );
  await attachScreenshot(page, testInfo, "request-send-on");
});

test("[scenario:request-usdc-off] own oracles paid in USDC (approve, then request), decision Off: the bulb ends off", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await connectTestWallet(page);
  await customizeSelection(page);

  // Own oracles: drop the last default one and require all that remain.
  const section = oraclesSection(page);
  const checked = section.getByRole("checkbox", { checked: true });
  const n = await checked.count();
  if (n > 2) await toggle(checked.last());
  const more = page.getByRole("button", { name: "More oracles must agree" });
  while (await more.isEnabled()) await more.click();
  await expect(page.getByTestId("selection-error")).toBeHidden();
  await goToStep(page, 3);

  // Pay in USDC: the cost follows the toggle, in USDC throughout, rows add up; approve exactly the total, then request.
  await page.getByRole("radiogroup", { name: "Pay with" }).getByText("USDC", { exact: true }).click();
  await expect(page.getByTestId("cost-total")).toContainText("USDC");
  const cost = page.getByTestId("cost");
  await expect(cost).not.toContainText("ETH");
  await expect(paySection(page)).toContainText("Request fee");
  await expect(paySection(page)).toContainText("Network gas extra, paid in local ETH");
  await expect(paySection(page).getByText("Amounts in USDC")).toBeVisible();
  await expectRowsSumToTotal(page, 6);
  const approve = page.getByTestId("approve");
  const send = page.getByTestId("send");
  await expect(page.getByTestId("usdc-step-approve")).toBeVisible();
  if (await approve.isVisible()) {
    await expect(approve).toContainText("Approve");
    await expect(send).toBeDisabled();
    await approve.click();
    await expect(approve).toBeHidden();
    await expect(page.getByTestId("usdc-step-approve")).toContainText("USDC approved");
  } else {
    testInfo.annotations.push({ type: "note", description: "USDC allowance already sufficient; approve skipped" });
  }
  await expect(page.getByTestId("usdc-step-approve")).toHaveAttribute("data-done", "true");

  const id = await sendAndConfirm(page);
  // Both steps read completed after the request, whatever the refreshed allowance.
  await expect(page.getByTestId("usdc-step-approve")).toContainText("USDC approved");
  await expect(page.getByTestId("usdc-step-approve")).toHaveAttribute("data-done", "true");
  await expect(page.getByTestId("usdc-step-send")).toContainText("Request sent");
  await expect(page.getByTestId("usdc-step-send")).toHaveAttribute("data-done", "true");
  await page.getByTestId("payment-details").getByRole("button", { name: "Payment details" }).click();
  await expect(page.getByTestId("payment-details")).toContainText("USDC");

  await followToRuling(page, id, 2);
  await expect(page.getByTestId("dispute-record")).toContainText("USDC");
  await attachScreenshot(page, testInfo, "request-usdc-off");
});

test("[scenario:request-quote-stale] a changed token or selection is stale at once; send waits for the new quote", async ({
  page,
}, testInfo) => {
  await page.goto("/?quote=1500");
  await connectTestWallet(page);
  await goToStep(page, 3);
  await quoteReady(page);
  const send = page.getByTestId("send");
  await expect(send).toBeEnabled();
  const status = page.getByTestId("cost-status");

  // Token change: stale at once, approval and send disabled, "Updating cost…", until the USDC quote arrives.
  const fast = await slowRpc(page, 1500);
  await page.getByRole("radiogroup", { name: "Pay with" }).getByText("USDC", { exact: true }).click();
  await expect(send).toBeDisabled();
  await expect(status).toHaveText("Updating cost…");
  await expect(page.getByTestId("approve")).toBeDisabled();
  await expect(page.getByTestId("cost")).toBeHidden();
  await attachScreenshot(page, testInfo, "request-quote-stale");
  await fast();
  await expect(page.getByTestId("cost-total")).toContainText("USDC");
  await expect(page.getByTestId("cost-total")).toBeVisible();

  // Selection change: the same, seen on step 3 once the choice is made on step 2.
  await page.getByRole("radiogroup", { name: "Pay with" }).getByText("ETH", { exact: true }).click();
  await quoteReady(page);
  await expect(page.getByTestId("cost-total")).toContainText("ETH");
  await customizeSelection(page);
  const checked = oraclesSection(page).getByRole("checkbox", { checked: true });
  const slow = await slowRpc(page, 1500);
  await toggle(checked.last());
  await goToStep(page, 3);
  await expect(send).toBeDisabled();
  await expect(status).toBeVisible();
  await slow();
  await expect(page.getByTestId("cost-total")).toBeVisible();
  await expect(send).toBeEnabled();

  // The configuration is frozen while a transaction is pending (Back, the markers and Edit are disabled), with the
  // submitted summary kept.
  const hold = await slowRpc(page, 2500);
  await send.click();
  await expect(page.getByRole("radio", { name: "USDC" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "ETH" })).toBeDisabled();
  await expect(page.getByTestId("back")).toBeDisabled();
  for (const id of ["marker-1", "marker-2", "edit-route", "edit-oracles"]) await expect(page.getByTestId(id)).toBeDisabled();
  await expect(page.getByTestId("submitted-summary")).toContainText("Custom selection");
  await hold();
  await expect(page.getByTestId("request-success")).toBeVisible();
  await expect(page.getByTestId("submitted-summary")).toContainText("Custom selection");
});

test("[scenario:request-network-route] three steps, the fixed local route, wallet states, at desktop and 375 px", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const route = routeSection(page);
  await expect(route).toBeVisible();
  const count = page.getByTestId("step-count");
  await expect(count).toHaveText("Step 1 of 3");
  const markers = page.locator('[data-testid^="marker-"]');
  await expect(markers).toHaveCount(3);
  for (const [i, label] of ["Network route", "Choose oracles", "Pay and send"].entries())
    await expect(markers.nth(i)).toContainText(label);
  await expect(page.getByTestId("chain-from")).toHaveText("Request from: Base-like · Local devnet");
  await expect(page.getByTestId("chain-to")).toHaveText("Court on: Arbitrum-like · Local devnet");
  await expect(route).toContainText("The ruling returns to Base-like. Only this local route is available.");
  await expect(page.getByTestId("local-badge")).toContainText("Local devnet only");
  await expect(page.getByTestId("local-badge")).toContainText("No public networks or testnets");
  await expect(route.locator("select")).toHaveCount(0);
  await expect(route.getByRole("button", { name: /swap|reverse/i })).toHaveCount(0);
  await expect(page.getByTestId("route")).toContainText("Local · Base-like → Arbitrum-like");

  // Disconnected: the route is readable, with both ways to connect; Continue needs no wallet and fees stay visible.
  await expect(route.getByRole("button", { name: "Use test wallet" })).toBeVisible();
  await expect(route.getByRole("button", { name: "Connect wallet" })).toBeVisible();
  await expect(route).toContainText("Local demo account");
  await expect(page.getByTestId("account-control")).toContainText("Not connected");

  // Network details: chain ids and local RPC addresses only.
  await route.getByRole("button", { name: "Network details" }).click();
  const details = page.getByTestId("network-details");
  await expect(details).toContainText(/chain id \d+/);
  await expect(details).toContainText(/http:\/\/(127\.0\.0\.1|localhost)/);
  expect(await details.innerText()).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/);

  await expectPlainText(page, "Request, disconnected");
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText).not.toMatch(/Ethereum|Sepolia|Mainnet|Base Sepolia/i);

  await page.getByTestId("continue").click();
  await expect(count).toHaveText("Step 2 of 3");
  await goToStep(page, 3);
  await quoteReady(page);
  await expect(paySection(page).getByRole("button", { name: "Use test wallet" })).toBeVisible();
  await goToStep(page, 1);

  // At every width the Route preview sits under the steps.
  const preview = (await page.getByRole("heading", { name: "Route preview" }).boundingBox())!;
  const stepsBox = (await page.getByTestId("step-1").boundingBox())!;
  expect(preview.y).toBeGreaterThanOrEqual(stepsBox.y + stepsBox.height - 1);

  // Connected: the wallet is named for the route.
  await connectTestWallet(page);
  await expect(page.getByTestId("wallet-state")).toHaveText("Wallet on Base-like local devnet");
  await expect(route).toContainText("Local demo account · ready to pay");
  await expect(page.getByTestId("account-control")).toContainText("Test wallet");
  await expectPlainText(page, "Request, connected");

  // The pill links to the route: from another step it brings step 1 back.
  await goToStep(page, 2);
  await page.getByTestId("route").click();
  await expect(page).toHaveURL(/#network-route$/);
  await expect(count).toHaveText("Step 1 of 3");
  await attachScreenshot(page, testInfo, "request-network-route");

  // 375 px: the same steps, the preview below them, the route pill, the local badge and the account control in view.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByTestId("route")).toBeVisible();
  await expect(page.getByTestId("account-control")).toBeVisible();
  await expect(page.getByTestId("local-badge")).toBeVisible();
  const xs: number[] = [];
  for (const i of [0, 1, 2]) {
    const box = (await markers.nth(i).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    xs.push(box.x);
  }
  expect(xs[0]).toBeLessThan(xs[1]);
  expect(xs[1]).toBeLessThan(xs[2]);
  const panel = (await page.getByTestId("step-1").boundingBox())!;
  const below = (await page.getByRole("heading", { name: "Route preview" }).boundingBox())!;
  expect(below.y).toBeGreaterThanOrEqual(panel.y + panel.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expect(route.getByRole("button", { name: "Use test wallet" })).toBeVisible();
  await expect(route.getByRole("button", { name: "Connect wallet" })).toBeVisible();
  await expectPlainText(page, "Request at 375 px");
});

test("[scenario:request-carousel] Continue, Back, the markers and Edit move between the steps and keep every choice", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await connectTestWallet(page);
  const count = page.getByTestId("step-count");
  const next = page.getByTestId("continue");
  await expect(count).toHaveText("Step 1 of 3");
  // Only the active step is rendered; later markers are not clickable yet.
  await expect(page.getByRole("heading", { name: "Choose oracles", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("send")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByTestId("marker-2")).toBeDisabled();
  await expect(page.getByTestId("marker-3")).toBeDisabled();
  await expect(page.getByTestId("back")).toHaveCount(0);

  // A short entrance slide in the direction of travel; none under reduced motion.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await next.click();
  await expect(count).toHaveText("Step 2 of 3");
  expect(await page.getByTestId("step-2").evaluate((el) => getComputedStyle(el).animationName)).not.toBe("none");
  await expect(page.getByRole("heading", { name: "Choose oracles", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Network route", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("chain-from")).toHaveCount(0);

  // Choices: customize, drop one oracle.
  await customizeSelection(page);
  const boxes = oraclesSection(page).getByRole("checkbox", { checked: true });
  const before = await boxes.count();
  await toggle(boxes.last());
  await expect(boxes).toHaveCount(before - 1);
  const summaryAfter = before - 1;

  // Back keeps them and focuses the heading of step 1.
  await page.getByTestId("back").click();
  await expect(count).toHaveText("Step 1 of 3");
  await expect(page.getByRole("heading", { name: "Network route", exact: true })).toBeFocused();
  await next.click();
  await expect(oraclesSection(page).getByRole("checkbox", { checked: true })).toHaveCount(summaryAfter);

  // Continue is disabled with the reason while the selection is invalid, and the markers follow.
  const more = page.getByRole("button", { name: "More oracles must agree" });
  while (await more.isEnabled()) await more.click();
  await toggle(oraclesSection(page).getByRole("checkbox", { checked: true }).last());
  await expect(next).toBeDisabled();
  await expect(page.getByTestId("continue-reason")).toBeVisible();
  await expect(page.getByTestId("marker-3")).toBeDisabled();
  await page.getByRole("button", { name: "Fewer oracles must agree" }).click();
  await expect(next).toBeEnabled();

  // Reduced motion: the step change is instant.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await next.click();
  await expect(count).toHaveText("Step 3 of 3");
  expect(await page.getByTestId("step-3").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await expect(page.getByRole("heading", { name: "Pay and send", exact: true })).toBeFocused();
  await expect(page.getByTestId("review-selection")).toContainText("Custom selection");
  // Edit returns to the step; every choice is still there; a reached marker goes forward again.
  await page.getByTestId("edit-oracles").click();
  await expect(count).toHaveText("Step 2 of 3");
  await expect(oraclesSection(page).getByRole("checkbox", { checked: true })).toHaveCount(summaryAfter - 1);
  await page.getByTestId("marker-3").click();
  await expect(count).toHaveText("Step 3 of 3");
  await page.getByTestId("edit-route").click();
  await expect(count).toHaveText("Step 1 of 3");
  await page.getByTestId("marker-3").click();
  await expect(count).toHaveText("Step 3 of 3");
  await quoteReady(page);

  // No wrapped button, select or label text and no sideways page scroll at 375, 768 and 1440 px.
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const n of [1, 2, 3] as const) {
      await goToStep(page, n);
      await expectNoWrap(page, `Request step ${n} at ${width} px`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Send: the completion panel replaces the steps; "Start a new request" returns to step 1 with the default selection.
  await goToStep(page, 3);
  const id = await sendAndConfirm(page);
  await expect(page.getByTestId("request-success")).toContainText(`Request #${id} sent`);
  await expect(page.getByRole("link", { name: "Track request" })).toBeVisible();
  await expect(page.getByTestId("step-count")).toHaveCount(0);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoWrap(page, `Request sent at ${width} px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await attachScreenshot(page, testInfo, "request-carousel");
  await page.getByRole("button", { name: "Start a new request" }).click();
  await expect(count).toHaveText("Step 1 of 3");
  await goToStep(page, 2);
  await expect(page.getByTestId("selection-summary")).toContainText(/^Default selection/);
});

// Track and Request read the same current bulb, even when an older request's decision lands last.
test("Track shows the wallet's current bulb, not the last ruling of the tracked request", async ({ page }) => {
  test.setTimeout(240_000);
  // The fake setup keeps its state in memory and loses it on a reload; this needs the devnet.
  const res = await page.request.get("/devnet.json");
  test.skip(!res.ok() || !(res.headers()["content-type"] ?? "").includes("json"), "devnet build only");
  await page.goto("/");
  await connectTestWallet(page);
  const first = await sendAndConfirm(page);
  await page.getByRole("button", { name: "Start a new request" }).click();
  await goToStep(page, 3);
  await quoteReady(page);
  const second = await sendAndConfirm(page);

  // The newer request is ruled On first, the older one Off afterwards: the bulb ends off.
  await followToRuling(page, second, 1);
  await page.goto(`/track/${first}`);
  await expect(page.getByTestId("log-dispute-received")).toHaveAttribute("data-state", "done", { timeout: 120_000 });
  await page.getByRole("button", { name: "Decide Off" }).click();
  await expect(page.getByTestId("track-stage")).toHaveAttribute("data-stage", "switched", { timeout: 120_000 });

  await page.goto(`/track/${second}`);
  // The headline is this request's own outcome; the requester's current bulb is a separate field that says it differs.
  // (The reload dropped the in-page wallet, so it is "Requester's", not "Your".)
  await expect(page.getByTestId("now-title")).toHaveText("Request complete · bulb set On");
  await expect(page.getByTestId("now")).toContainText("Requester's bulb now");
  await expect(page.getByTestId("bulb-now")).toContainText("Off");
  await expect(page.getByTestId("bulb-now")).toContainText("The current state differs from this request's result.");
  await showCircuit(page);
  await expect(page.getByTestId("circuit-bulb")).toHaveAttribute("data-state", "off");
  await page.goto("/");
  // A reload drops the in-page test wallet; reconnect it so Request reads the same wallet's bulb.
  await connectTestWallet(page);
  await expect(page.locator("body")).toContainText("Your bulb is off");
});
