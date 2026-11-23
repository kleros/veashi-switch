import { expect, test } from "@playwright/test";
import { attachScreenshot, connectTestWallet, expectNoWrap, expectPlainText, sendAndConfirm, trackUntilCourt } from "./helpers";

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
  await page.goto("/?step=300");
  await connectTestWallet(page);
  const id = await sendAndConfirm(page);
  await trackUntilCourt(page, id);

  // In court: the requester's current bulb, read without the ruling, and the answer that flips it.
  const bulbNow = page.getByTestId("bulb-now");
  await expect(bulbNow).toHaveText(/^(On|Off)$/);
  const state = (await bulbNow.innerText()).trim() as "On" | "Off";
  await expect(page.getByTestId("juror-line")).toHaveText(JUROR[state]);
  await expect(page.getByTestId("bulb")).toHaveAttribute("data-state", "waiting");
  const caseText = await page.getByTestId("track-case").innerText();
  const caseId = /^Court case #(\d+) · /.exec(caseText)?.[1];
  expect(caseId, `court case number in "${caseText}"`).toBeTruthy();
  await expectPlainText(page, "Track in court");
  await attachScreenshot(page, testInfo, "juror-court-stage");

  // Find takes the court case number and lands on the request (in-app, so the fake setup keeps its requests).
  await page.getByRole("button", { name: "Find or switch request" }).click();
  await page.getByTestId("find-kind-case").check();
  await expect(page.locator("label[for=open-id]")).toHaveText("Court case ID");
  await page.locator("input#open-id").fill(caseId!);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${id}$`));
  await expect(page.getByTestId("track-title")).toHaveText(`Request #${id}`);
  await expect(page.getByTestId("juror-line")).toHaveText(JUROR[state]);

  // The deep link a court case can carry: /case/<number>. The fake setup forgets its requests on a reload, so there
  // it opens a seeded one (request 2 is court case 1).
  const [target, request] = (await isFake(page)) ? ["1", "2"] : [caseId!, id];
  await page.goto(`/case/${target}`);
  await expect(page).toHaveURL(new RegExp(`/track/${request}$`));
  await expect(page.getByTestId("track-title")).toHaveText(`Request #${request}`);
  await expect(page.getByTestId("track-case")).toHaveText(new RegExp(`^Court case #${target} · `));
});

test("a court case that is not a lightbulb request, or not a number, says so and offers the case search", async ({ page }) => {
  await page.goto("/case/999999");
  await expect(page.getByTestId("case-title")).toHaveText("No request for court case #999999");
  await expect(page.getByTestId("case-missing")).toContainText("Court case #999999 was not opened by a lightbulb request on this site.");
  await expect(page.getByTestId("case-loading")).toHaveCount(0);
  await expect(page.getByTestId("find-kind-case")).toBeChecked();
  await expectPlainText(page, "case not found");
  await expectNoWrap(page, "case not found");

  await page.goto("/case/abc");
  await expect(page.getByTestId("case-title")).toHaveText("Not a court case number");
  await page.goto("/case");
  await expect(page.getByTestId("case-title")).toHaveText("Find a court case");
  await expect(page.getByTestId("find-kind-case")).toBeChecked();
  // the request search is unchanged: Request is the default kind on Track
  await page.goto("/track/abc");
  await expect(page.getByTestId("find-kind-request")).toBeChecked();
  await expect(page.locator("label[for=open-id]")).toHaveText("Request ID");
});
