import { expect, test, type Page } from "@playwright/test";
import { connectTestWallet, expectPlainText, sendAndConfirm, showSteps } from "./helpers";

// The creation-failure path: the court side cannot open the case, its creation window closes, anyone sends the
// failure back, the request closes with the bulb unchanged and the juror fees are claimed back. On the devnet the
// HomeGateway's balance is set to 0 for the test (the relay service never sends failures), and restored after.

interface DevnetJson {
  home: { rpcUrl: string };
  addresses: { home: { HomeGateway: string } };
}

async function devnetJson(page: Page): Promise<DevnetJson | null> {
  const res = await page.request.get("/devnet.json");
  if (!res.ok() || !(res.headers()["content-type"] ?? "").includes("json")) return null;
  return (await res.json()) as DevnetJson;
}

async function rpc(page: Page, url: string, method: string, params: unknown[]): Promise<string> {
  const res = await page.request.post(url, { data: { jsonrpc: "2.0", id: 1, method, params } });
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result ?? "";
}

test("[scenario:creation-failure] a case the court cannot open: the failure goes back, the request closes, the refund is claimed", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const env = await devnetJson(page);
  let restore = async () => {};
  if (env) {
    const { rpcUrl } = env.home;
    const gateway = env.addresses.home.HomeGateway;
    const balance = await rpc(page, rpcUrl, "eth_getBalance", [gateway, "latest"]);
    await rpc(page, rpcUrl, "anvil_setBalance", [gateway, "0x0"]);
    restore = async () => void (await rpc(page, rpcUrl, "anvil_setBalance", [gateway, balance]));
  }
  try {
    await page.goto(env ? "/" : "/?creation=fail&step=300&window=3000");
    await connectTestWallet(page);
    const id = await sendAndConfirm(page);
    await page.getByRole("link", { name: "Track request" }).click();
    await showSteps(page);

    // Delivered, but the court side cannot pay for the case: the opening step waits and says why.
    const opening = page.getByTestId("log-dispute-received");
    await expect(page.getByTestId("track-stage")).toHaveAttribute("data-stage", "dispute-delivered", { timeout: 120_000 });
    await expect(page.getByTestId("now")).toContainText("lacks local ETH to open the case", { timeout: 60_000 });
    await expect(opening).toContainText("Court cannot open the case yet");
    await expect(page.getByTestId("act-create-dispute")).toHaveCount(0);

    // Once the window closes, anyone may send the failure back.
    const send = page.getByTestId("act-send-failure");
    await expect(send).toBeVisible({ timeout: 120_000 });
    await expect(opening).toContainText("Court did not open the case in time");
    await expectPlainText(page, `Track window closed #${id}`);
    await send.getByRole("button", { name: "Send the failure back" }).click();

    // The failure returns over the same oracles and closes the request; the bulb is unchanged.
    await expect(page.getByTestId("track-stage")).toHaveAttribute("data-stage", "closed", { timeout: 120_000 });
    await expect(page.getByTestId("log-creation-failed")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("log-failure-relaying")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("log-closed")).toContainText("Request closed · refund available");
    await expect(page.getByTestId("ruling")).toContainText("None: the case was not opened");
    await expect(page.getByTestId("refund")).toContainText("not claimed yet");

    // The refund: one claim pays the juror fees to the requester, and the step is gone.
    const claim = page.getByTestId("act-claim-refund");
    await claim.getByRole("button", { name: /^Claim refund/ }).click();
    await expect(page.getByTestId("refund")).toContainText("paid to", { timeout: 60_000 });
    await expect(claim).toHaveCount(0);
    await expect(page.getByTestId("log-closed")).toContainText("Request closed · juror fees refunded");
    await expect(page.getByTestId("step-error")).toHaveCount(0);
    await expectPlainText(page, `Track closed #${id}`);
  } finally {
    await restore();
  }
});
