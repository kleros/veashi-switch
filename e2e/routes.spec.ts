// Several routes on one site: the fake setup's ?routes=2 adds an Arc-like route (gas paid in USDC with 18 decimals, no
// USDC token, one oracle: Axelar) beside the Base-like one, with the court on the same Arbitrum-like chain. The
// devnet has one route, so these run on the fake setup only.
import { expect, test, type Page } from "@playwright/test";
import { attachScreenshot, expectNoWrap, expectPlainText, expectRowsSumToTotal, goToStep, routeSection } from "./helpers";

async function isFake(page: Page) {
  const res = await page.request.get("/devnet.json");
  return !res.ok() || !(res.headers()["content-type"] ?? "").includes("json");
}

/** Connects the test wallet on the picked route's foreign chain. */
async function connectOn(page: Page, foreign: string) {
  await goToStep(page, 1);
  const state = page.getByTestId("wallet-state");
  const useTest = routeSection(page).getByRole("button", { name: "Use test wallet" });
  if (await useTest.isVisible()) await useTest.click();
  const switchChain = routeSection(page).getByTestId("switch-chain");
  await expect(state.filter({ hasText: `Wallet on ${foreign} local devnet` }).or(switchChain).first()).toBeVisible();
  if (await switchChain.isVisible()) await switchChain.click();
  await expect(state).toHaveText(`Wallet on ${foreign} local devnet`);
}

test("[scenario:routes-pick] the Request page picks the route; fees, token, wallet chain and the header follow it; Track URLs name it", async ({
  page,
}, testInfo) => {
  test.skip(!(await isFake(page)), "fake setup only");
  await page.goto("/?routes=2");
  const picker = page.getByTestId("route-picker");
  await expect(picker).toBeVisible();
  await expect(page.getByTestId("route-option-base").getByRole("radio")).toBeChecked();
  await expect(page.getByTestId("route-option-base")).toContainText("Pay in ETH or USDC");
  await expect(page.getByTestId("route-option-arc")).toContainText("Pay in USDC");
  await expect(page.getByTestId("chain-from")).toHaveText("Request from: Base-like · Local devnet");
  await expect(page.getByTestId("route")).toHaveText("Local · Base-like → Arbitrum-like");

  // Pick Arc-like: the page starts again for that route, the focus stays on the choice, the header follows.
  await page.getByTestId("route-option-arc").getByRole("radio").check();
  await expect(page.getByTestId("route-option-arc").getByRole("radio")).toBeChecked();
  await expect(page.getByTestId("route-option-arc").getByRole("radio")).toBeFocused();
  await expect(page.getByTestId("chain-from")).toHaveText("Request from: Arc-like · Local devnet");
  await expect(page.getByTestId("route")).toHaveText("Local · Arc-like → Arbitrum-like");
  await connectOn(page, "Arc-like");

  await goToStep(page, 2);
  await expect(page.getByTestId("selection-summary")).toContainText("Default selection · Axelar · 1 must agree");
  await page.getByRole("button", { name: "Customize selection" }).click();
  await expect(page.getByText("Fee (USDC)")).toBeVisible();
  await page.getByTestId("use-default").first().click();

  await goToStep(page, 3);
  await expect(page.getByRole("radiogroup", { name: "Pay with" })).toHaveCount(0);
  await expect(page.getByTestId("pay-token")).toHaveText("USDC, the gas token of Arc-like");
  await expect(page.getByTestId("cost-total")).toHaveText("7.135 USDC"); // 0.0027 ETH × 2450 + 0.52 (Axelar)
  await expect(page.locator("body")).toContainText("Network gas extra, paid in local USDC");
  await expect(page.getByTestId("balance")).toHaveText("Your balance: 25.00 USDC");
  await expectRowsSumToTotal(page, 18);
  await expect(page.getByTestId("usdc-step-approve")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("approval", { useInnerText: true });
  await expectPlainText(page, "Request on Arc-like");
  await attachScreenshot(page, testInfo, "routes-pick-arc-pay");

  await page.getByTestId("send").click();
  const ok = page.getByTestId("request-success");
  await expect(ok).toContainText("Request #2 sent"); // the Arc-like route's own count: its seeded #1, then #2
  await page.getByRole("link", { name: "Track request" }).click();
  await expect(page).toHaveURL(/\/track\/arc\/2$/);
  await expect(page.getByTestId("track-title")).toHaveText("Request #2 · Arc-like");
  await expect(page.getByTestId("record-route")).toHaveText("Arc-like → Arbitrum-like → Arc-like · Local devnet");
  await expect(page.getByTestId("route")).toHaveText("Local · Arc-like → Arbitrum-like");
  await expect(page.getByTestId("dispute-record")).toContainText("7.135 USDC");
  await expect(page.getByTestId("dispute-record")).not.toContainText("ETH");

  // Request IDs are per route: the Find dialog lists both routes' requests under their network.
  await page.getByTestId("find-request").click();
  const mine = page.getByTestId("my-requests");
  await expect(mine).toContainText("Base-like · Request #1");
  await expect(mine).toContainText("Arc-like · Request #1");
  await expect(page.getByTestId("request-option-arc-2")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("request-option-1")).toHaveAttribute("href", "/track/1");
  await expect(page.getByTestId("request-option-arc-1")).toHaveAttribute("href", "/track/arc/1");
  await page.getByTestId("request-option-1").click();
  await expect(page).toHaveURL(/\/track\/1$/);
  await expect(page.getByTestId("track-title")).toHaveText("Request #1");
  await expect(page.getByTestId("record-route")).toHaveText("Base-like → Arbitrum-like → Base-like · Local devnet");
  await expect(page.getByTestId("route")).toHaveText("Local · Base-like → Arbitrum-like");

  // Find by request ID asks for the network (the one in view first); a court case number is looked up on every route.
  await page.getByTestId("find-request").click();
  const dialog = page.getByTestId("find-dialog");
  await expect(dialog.getByTestId("find-network-base")).toBeChecked();
  await dialog.getByTestId("find-network-arc").check();
  await dialog.locator("input#open-id").fill("1");
  await dialog.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/track\/arc\/1$/);
  await expect(page.getByTestId("track-case")).toHaveText("Court case #2 · Arbitrum-like");
  await page.getByTestId("find-request").click();
  await dialog.getByTestId("find-kind-case").check();
  await expect(dialog.getByTestId("find-network-arc")).toHaveCount(0);
  await dialog.locator("input#open-id").fill("1");
  await dialog.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/track\/2$/); // court case #1 is the Base-like route's request #2

  // /track with requests on both routes lists them per route instead of picking one; nothing claims a route there.
  await page.getByRole("link", { name: "Track", exact: true }).click();
  await expect(page).toHaveURL(/\/track$/);
  await expect(page.getByRole("heading", { name: "Your requests" })).toBeVisible();
  await expect(page.getByTestId("request-option-arc-2")).toBeVisible();
  await expect(page.getByTestId("request-option-2")).toBeVisible();
  await expect(page.getByTestId("route")).toHaveText("Local devnet");
  await expect(page.getByTestId("account-control")).not.toContainText("Wrong network");
});

test("[scenario:routes-links] route-qualified links, the default route's bare links, and /case across routes", async ({ page }, testInfo) => {
  test.skip(!(await isFake(page)), "fake setup only");
  // the fake setup forgets its requests on a reload: these are the seeded ones (Base-like #1 and #2, Arc-like #1)
  await page.goto("/track/arc/1?routes=2");
  await expect(page.getByTestId("track-title")).toHaveText("Request #1 · Arc-like");
  await expect(page.getByTestId("record-route")).toHaveText("Arc-like → Arbitrum-like → Arc-like · Local devnet");
  await expect(page.getByTestId("dispute-record")).toContainText("7.135 USDC");
  await expect(page.getByTestId("dispute-record")).not.toContainText("ETH");
  await expect(page.getByTestId("route")).toHaveText("Local · Arc-like → Arbitrum-like");
  await expectPlainText(page, "Arc-like request");

  await page.goto("/track/1?routes=2");
  await expect(page.getByTestId("track-title")).toHaveText("Request #1");
  await expect(page.getByTestId("record-route")).toHaveText("Base-like → Arbitrum-like → Base-like · Local devnet");
  await expect(page.getByTestId("dispute-record")).toContainText("ETH");

  await page.goto("/track/base/2?routes=2"); // the default route has one URL
  await expect(page).toHaveURL(/\/track\/2$/);
  await page.goto("/track/arc?routes=2"); // a route alone: the list spans every route
  await expect(page).toHaveURL(/\/track$/);
  await page.goto("/track/optimism/1?routes=2");
  await expect(page.getByRole("heading", { name: "No such network" })).toBeVisible();
  await page.goto("/track/arc/9?routes=2");
  await expect(page.getByTestId("track-title")).toHaveText("No request #9 · Arc-like");
  await expect(page.locator("body")).toContainText("There is no request with this ID on Arc-like.");

  // the court template's /case/<number> lands on the request whichever route opened the case
  await page.goto("/case/2?routes=2");
  await expect(page).toHaveURL(/\/track\/arc\/1$/);
  await page.goto("/case/1?routes=2");
  await expect(page).toHaveURL(/\/track\/2$/);
  await page.goto("/case/7?routes=2");
  await expect(page.getByTestId("case-title")).toHaveText("No request for court case #7");

  // ?route=arc picks the Arc-like route and leaves the URL
  await page.goto("/?routes=2&route=arc");
  await expect(page.getByTestId("route-option-arc").getByRole("radio")).toBeChecked();
  await expect(page).toHaveURL(/\/\?routes=2$/);

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/?routes=2");
  await expect(page.getByTestId("route-picker")).toBeVisible();
  await expectNoWrap(page, "Request with two routes, 375 px");
  await attachScreenshot(page, testInfo, "routes-picker-375");
});
