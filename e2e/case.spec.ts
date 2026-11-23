import { expect, test } from "@playwright/test";
import {
  attachScreenshot,
  connectTestWallet,
  expectNoWrap,
  expectPlainText,
  sendAndConfirm,
  showCircuit,
  showSteps,
  trackUntilCourt,
} from "./helpers";

async function isFake(page: import("@playwright/test").Page) {
  const res = await page.request.get("/devnet.json");
  return !res.ok() || !(res.headers()["content-type"] ?? "").includes("json");
}

const JUROR = {
  Off: "The bulb is off now, so the answer that flips it is “Switch it on”.",
  On: "The bulb is on now, so the answer that flips it is “Switch it off”.",
};

test("[scenario:juror-case] a court case number opens its request; in court it shows the requester's bulb and the answer that flips it", async ({
  page,
}, testInfo) => {
  // The fake setup's ?jurors=1 has no local decision, as on a testnet: the request stays in court, as jurors see it.
  const fake = await isFake(page);
  await page.goto(fake ? "/?step=300&jurors=1" : "/?step=300");
  await connectTestWallet(page);
  const id = await sendAndConfirm(page);
  await trackUntilCourt(page, id);

  // In court: the requester's current bulb, read without the ruling, drawn on the status card and said to screen readers.
  const bulbNow = page.getByTestId("bulb-now");
  await expect(bulbNow).toHaveText(/^(On|Off)$/);
  const state = (await bulbNow.innerText()).trim() as "On" | "Off";
  await expect(page.getByTestId("bulb")).toHaveAttribute("data-state", state.toLowerCase());
  await expect(page.getByTestId("bulb-state-text")).toHaveText(`Your bulb is ${state.toLowerCase()} now; the court has not decided yet`);
  const caseText = await page.getByTestId("track-case").innerText();
  const caseId = /^Court case #(\d+) · /.exec(caseText)?.[1];
  expect(caseId, `court case number in "${caseText}"`).toBeTruthy();
  if (fake) {
    await expect(page.getByTestId("now-title")).toHaveText(`Your request is in court · Court case #${caseId}`);
    await expect(page.getByTestId("juror-line")).toHaveText(JUROR[state]);
    // the bulb is read again when the tab comes back: a failed re-read says so (never the old value or answer) and
    // offers a retry, which brings both back
    await page.evaluate(() => {
      (window as unknown as { __veashi: object }).__veashi = { bulbFail: true };
      window.dispatchEvent(new Event("focus"));
    });
    await expect(bulbNow).toHaveText("Current bulb state unavailable", { timeout: 10_000 });
    await expect(page.getByTestId("juror-line")).toHaveText("The bulb could not be read. Use Retry bulb check before you vote.");
    await expect(page.getByTestId("bulb")).toHaveAttribute("data-state", "unknown");
    await page.evaluate(() => ((window as unknown as { __veashi: object }).__veashi = {}));
    await page.getByTestId("bulb-retry").click();
    await expect(bulbNow).toHaveText(state);
    await expect(page.getByTestId("juror-line")).toHaveText(JUROR[state]);
  } else {
    // the local demo decides itself (Decide On / Decide Off): there are no jurors
    await expect(page.getByTestId("juror-line")).toHaveCount(0);
  }
  await expectPlainText(page, "Track in court");
  await attachScreenshot(page, testInfo, "juror-court-stage");

  // Find takes a court case number and looks it up in the dialog: a case that is no request's is said under the field.
  const find = page.getByTestId("find-request");
  await find.click();
  await page.getByTestId("find-kind-case").check();
  await expect(page.locator("label[for=open-id]")).toHaveText("Court case number");
  const field = page.locator("input#open-id");
  await field.fill("999999");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByTestId("find-msg")).toHaveText("No request for court case #999999. Check the number Kleros Court shows as Case #.");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const msgId = await page.getByTestId("find-msg").getAttribute("id");
  await expect(field).toHaveAttribute("aria-describedby", msgId!);
  await expect(page).toHaveURL(new RegExp(`/track/${id}$`));
  await expect(page.getByTestId("find-dialog")).toBeVisible();

  // A case that is a request's opens it (in-app, so the fake setup keeps its requests: request 2 is court case 1), and
  // the page stays, so focus goes back to the button that opened the dialog.
  const [other, otherRequest] = fake ? ["1", "2"] : [caseId!, id];
  await field.fill(other);
  await expect(page.getByTestId("find-msg")).toHaveText("");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${otherRequest}$`));
  await expect(page.getByTestId("track-title")).toHaveText(`Request #${otherRequest}`);
  await expect(page.getByTestId("track-case")).toHaveText(new RegExp(`^Court case #${other} · `));
  await expect(find).toBeFocused();

  // The deep link a court case can carry: /case/<number>. The fake setup forgets its requests on a reload, so there
  // it opens a seeded one.
  await page.goto(`/case/${other}`);
  await expect(page).toHaveURL(new RegExp(`/track/${otherRequest}$`));
  await expect(page.getByTestId("track-title")).toHaveText(`Request #${otherRequest}`);
  await expect(page.getByTestId("track-case")).toHaveText(new RegExp(`^Court case #${other} · `));
});

test("a court case that is not a lightbulb request, or not a number, says so and offers the case search", async ({ page }) => {
  await page.goto("/case/999999");
  await expect(page.getByTestId("case-title")).toHaveText("No request for court case #999999");
  // the answer replaces the loader's status: the title takes focus, so a screen reader says it
  await expect(page.getByTestId("case-title")).toBeFocused();
  await expect(page.getByTestId("case-missing")).toContainText("Court case #999999 was not opened by a lightbulb request on this site.");
  await expect(page.getByTestId("case-loading")).toHaveCount(0);
  await expect(page.getByTestId("find-kind-case")).toBeChecked();
  // Track is the current page in the menu: /case finds a request for it
  await expect(page.getByRole("link", { name: "Track", exact: true })).toHaveAttribute("aria-current", "page");
  await expectPlainText(page, "case not found");
  await expectNoWrap(page, "case not found");

  await page.goto("/case/abc");
  await expect(page.getByTestId("case-title")).toHaveText("Not a court case number");
  // above uint256 no court case can have the number
  await page.goto(`/case/${(2n ** 256n).toString()}`);
  await expect(page.getByTestId("case-title")).toHaveText("Not a court case number");
  await page.goto("/case");
  await expect(page.getByTestId("case-title")).toHaveText("Find a court case");
  await expect(page.getByTestId("find-kind-case")).toBeChecked();

  // a long number wraps in the title on a phone: no sideways scroll
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/case/${"9".repeat(77)}`);
  await expect(page.getByTestId("case-title")).toHaveText(`No request for court case #${"9".repeat(77)}`);
  await expectNoWrap(page, "long case number at 375");
  await page.setViewportSize({ width: 1280, height: 900 });

  // the request search is unchanged: Request ID is the default kind on Track
  await page.goto("/track/abc");
  await expect(page.getByTestId("find-kind-request")).toBeChecked();
  await expect(page.locator("label[for=open-id]")).toHaveText("Request ID");

  // a failed lookup is an error with a retry, not "no request"; Retry keeps focus on the page (fake setup: an outage)
  if (await isFake(page)) {
    await page.addInitScript(() => ((window as unknown as { __veashi: object }).__veashi = { outage: true }));
    await page.goto("/case/5");
    await expect(page.getByTestId("case-error")).toContainText("Could not look up court case #5");
    await page.getByTestId("case-retry").click();
    await expect(page.getByTestId("case-error")).toBeVisible();
    await expect(page.getByTestId("case-title")).toBeFocused();
  }
});

test("a request the court refused to arbitrate reads as a refusal everywhere, never as a bulb update", async ({ page }) => {
  test.skip(!(await isFake(page)), "fake setup only: the devnet's court rules On or Off");
  // ?refused=1 seeds request #90 (court case #90) of the test wallet, ruled 0 and applied
  await page.goto("/?refused=1");
  await connectTestWallet(page);
  await page.getByRole("link", { name: "Track", exact: true }).click();
  await expect(page).toHaveURL(/\/track\/\d+$/);
  await page.getByTestId("find-request").click();
  await expect(page.getByTestId("request-option-90")).toHaveText("Request #90 · Complete · bulb unchanged");
  await page.getByTestId("request-option-90").click();
  await expect(page).toHaveURL(/\/track\/90$/);

  await expect(page.getByTestId("now-title")).toHaveText("Request complete · bulb unchanged");
  await expect(page.getByTestId("track-stage")).toContainText("Decision: Refused to arbitrate");
  await expect(page.getByTestId("bulb-now")).toHaveText(/^(On|Off)$/); // a refusal sets nothing: never "differs"
  await expect(page.getByTestId("ruling")).toHaveText("Refused to arbitrate · bulb unchanged");
  await showSteps(page);
  await expect(page.getByTestId("log-ruled")).toContainText("Court refused to arbitrate");
  await expect(page.getByTestId("log-switched")).toContainText("Bulb unchanged · the court refused to arbitrate");
  await expect(page.getByTestId("log-switched")).toContainText("Decision applied");
  await expect(page.getByTestId("now")).not.toContainText(/bulb (set|updat)|not decided yet/i);
  await expect(page.getByTestId("progress")).not.toContainText(/bulb updat|not decided yet/i);
  await expectPlainText(page, "Track refused");
  await showCircuit(page);
  await expect(page.getByTestId("node-foreignIn")).toContainText("Decision applied");
  await expect(page.getByTestId("bulb-label")).toContainText(/^Bulb unchanged: (On|Off)/);
  await expect(page.getByTestId("progress")).not.toContainText(/bulb updat|not decided yet/i);

  await page.getByTestId("technical-details").getByRole("button", { name: "Technical details" }).click();
  const tech = page.getByTestId("technical-details");
  await expect(tech).toContainText("Ruling code 0 (0 = refused to arbitrate, 1 = On, 2 = Off)");
  await expect(tech).toContainText("ruling 0 leaves the bulb as it was");
});
