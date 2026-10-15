import { expect, test } from "@playwright/test";
import { connectTestWallet, expectPlainText, goToStep, sendAndConfirm, showCircuit } from "./helpers";

// Failure states that only the fake setup can stage (`?fail=`, `?stall=1`); skipped on the devnet build.
async function isFake(page: import("@playwright/test").Page) {
  const res = await page.request.get("/devnet.json");
  return !res.ok() || !(res.headers()["content-type"] ?? "").includes("json");
}

test("a send that fails before or after mining reads differently, with the detail under Technical details", async ({ page }) => {
  test.skip(!(await isFake(page)), "fake setup only");
  for (const [fail, title] of [
    ["cancel", "Cancelled before sending"],
    ["revert", "Transaction failed—network gas may have been used"],
  ] as const) {
    await page.goto(`/?fail=${fail}`);
    await connectTestWallet(page);
    await goToStep(page, 3);
    await expect(page.getByTestId("send")).toBeEnabled();
    await page.getByTestId("send").click();
    const err = page.getByTestId("request-error");
    await expect(err).toContainText(title);
    await expect(err).not.toContainText(/InsufficientPayment|InvalidThreshold|Nothing was charged/);
    await err.getByRole("button", { name: "Technical details" }).click();
    await expect(err).toContainText(/InsufficientPayment|InvalidThreshold/);
  }
});

test("a paid request whose delivery paused says so, with the operator action and a duplicate warning", async ({ page }) => {
  test.skip(!(await isFake(page)), "fake setup only");
  await page.goto("/?stall=1&step=300");
  await connectTestWallet(page);
  const id = await sendAndConfirm(page);
  await page.getByRole("link", { name: "Track request" }).click();
  const paused = page.getByTestId("paused");
  await expect(paused).toBeVisible();
  await expect(page.getByTestId("now")).toContainText("Request paid; delivery paused");
  await expect(paused).toContainText("Last successful step");
  await expect(page.getByTestId("now")).toContainText("fund it");
  expect(((await page.getByTestId("now").innerText()).match(/lacks local ETH/g) ?? []).length).toBe(1);
  await expect(paused).not.toContainText(/relay service/i);
  await expect(paused).toContainText("Do not create a duplicate request");
  await expect(page.getByTestId("refresh-status")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Cancelled before sending|HomeGateway/);
  await expectPlainText(page, `Track paused #${id}`);
  await paused.getByRole("button", { name: "Technical details" }).click();
  await expect(paused).toContainText("HomeGateway");
});

test("Track keeps the bulb neutral until the current-state read resolves, and offers a retry if it fails", async ({ page }) => {
  test.skip(!(await isFake(page)), "fake setup only");
  for (const [qs, failed] of [["bulbDelay=4000", false], ["bulbFail=1", true]] as const) {
    await page.goto(`/?step=300&${qs}`);
    await connectTestWallet(page);
    const id = await sendAndConfirm(page);
    await page.getByRole("link", { name: "Track request" }).click();
    await expect(page.getByRole("button", { name: "Decide On" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Decide On" }).click();
    await expect(page.getByTestId("track-stage")).toHaveAttribute("data-stage", "switched", { timeout: 60_000 });
    if (failed) {
      // a completed request still says so; the current bulb is unavailable with a retry, and nothing says "Done"
      await expect(page.getByTestId("now-title")).toHaveText(/^Request complete · bulb set (On|Off)$/, { timeout: 10_000 });
      await expect(page.getByTestId("bulb-now")).toContainText("Current bulb state unavailable", { timeout: 10_000 });
      await expect(page.getByTestId("bulb-retry")).toHaveText("Retry bulb check");
      await expect(page.getByTestId("bulb")).toHaveAttribute("data-state", "unknown");
      await expect(page.getByTestId("now")).not.toContainText(/Nothing\. Done|waiting for the decision/i);
    } else {
      // read the text once, without retrying, while the delayed read is still pending
      expect(await page.getByTestId("bulb-now").innerText()).toContain("Checking bulb…");
      expect(await page.getByTestId("bulb").getAttribute("data-state")).toBe("unknown");
      expect(await page.getByTestId("now").innerText()).not.toMatch(/bulb now: (on|off)/i);
      await expect(page.getByTestId("bulb-now")).toContainText("On", { timeout: 10_000 });
    }
    await expectPlainText(page, `Track bulb read #${id}`);
  }
});

test("an uncertain submission makes Check your requests primary, and Send again needs an acknowledgement", async ({ page }) => {
  test.skip(!(await isFake(page)), "fake setup only");
  await page.goto("/?fail=unknown");
  await connectTestWallet(page);
  await goToStep(page, 3);
  await expect(page.getByTestId("send")).toBeEnabled();
  await page.getByTestId("send").click();
  await expect(page.getByTestId("request-error")).toContainText("The request could not be completed");
  await expect(page.getByTestId("request-error")).toContainText("Submitted:");
  await expect(page.getByTestId("check-requests")).toHaveText("Check your requests");
  await expect(page.getByTestId("send")).toHaveText("Send again…");
  await expect(page.getByTestId("send")).toBeDisabled();
  await page.getByTestId("ack-again").locator("xpath=..").click();
  await expect(page.getByTestId("send")).toBeEnabled();
  // a confirmed revert keeps the ordinary retry
  await page.goto("/?fail=revert");
  await connectTestWallet(page);
  await goToStep(page, 3);
  await page.getByTestId("send").click();
  await expect(page.getByTestId("request-error")).toBeVisible();
  await expect(page.getByTestId("check-requests")).toHaveCount(0);
  await expect(page.getByTestId("send")).toBeEnabled();
});

test("Track keeps the last known status through a read outage and recovers; the quote error has a working retry", async ({ page }) => {
  test.skip(!(await isFake(page)), "fake setup only");
  await page.goto("/?step=600");
  await connectTestWallet(page);
  await goToStep(page, 3);
  await expect(page.getByTestId("send")).toBeEnabled();
  await page.evaluate(() => ((window as unknown as { __veashi: object }).__veashi = { quoteFail: true }));
  await page.getByRole("radio", { name: "USDC" }).check({ force: true });
  await expect(page.getByTestId("cost-status")).toContainText("does not answer");
  await page.evaluate(() => ((window as unknown as { __veashi: object }).__veashi = {}));
  await page.getByRole("button", { name: "Retry fee calculation" }).click();
  await expect(page.getByTestId("cost-total")).toBeVisible();
  await page.getByRole("radio", { name: "ETH" }).check({ force: true });
  await expect(page.getByTestId("send")).toBeEnabled();
  await sendAndConfirm(page);
  await page.getByRole("link", { name: "Track request" }).click();
  await expect(page.getByTestId("now")).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __veashi: object }).__veashi = { outage: true }));
  await expect(page.getByTestId("stale-banner")).toContainText("Updates unavailable—showing last known status", { timeout: 15_000 });
  await expect(page.getByTestId("now")).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __veashi: object }).__veashi = {}));
  await expect(page.getByTestId("stale-banner")).toHaveCount(0, { timeout: 15_000 });
});

test("reduced motion: the circuit scrolls immediately and the bulb has no transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Route preview" })).toBeVisible();
  await showCircuit(page);
  const t = await page.getByTestId("circuit-bulb").locator(".bulb-glass").evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(t.split(",").every((d) => parseFloat(d) <= 0.001)).toBe(true);
});
