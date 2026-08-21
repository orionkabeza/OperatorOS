import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAndReachCounter } from "./helpers";

async function goToCashBox(page: import("@playwright/test").Page) {
  await signInAndReachCounter(page);
  await page.getByRole("button", { name: "Cash Box" }).click();
  await expect(page.getByRole("heading", { name: "Cash Box" })).toBeVisible();
}

test("balances band shows the till/momo/bank cards and updates a balance manually", async ({ page }) => {
  await goToCashBox(page);
  await expect(page.getByText("TILL")).toBeVisible();
  await expect(page.getByText(/BANK \(BK/)).toBeVisible();

  await page.getByRole("button", { name: "Update balance" }).first().click();
  await expect(page.getByText(/Update balance —/)).toBeVisible();
  await page.getByLabel("Counted balance").fill("999999");
  await page.getByRole("button", { name: "Save" }).click();
  // .first() — Radix Toast duplicates its message into an aria-live announcer for screen readers.
  await expect(page.getByText(/balance updated/).first()).toBeVisible();
});

test("MoMo reconciliation: matching an unmatched transaction moves it out of the unmatched total", async ({ page }) => {
  await goToCashBox(page);
  await page.getByRole("tab", { name: /MoMo reconciliation/ }).click();

  // Wait for the specific unmatched transaction to actually render before
  // reading the headline total — the total figure shows a "0" placeholder
  // until its query resolves (same as the transaction list's), and a plain
  // .textContent() read doesn't wait for that the way toBeVisible() does.
  const targetTxn = page.getByRole("button", { name: /RWF 45,000 Unmatched/ });
  await expect(targetTxn).toBeVisible();

  const totalText = await page.getByText(/unmatched across \d+ transactions/).textContent();
  const beforeCount = Number(totalText?.match(/across (\d+)/)?.[1] ?? "0");
  expect(beforeCount).toBeGreaterThan(0);

  // Select the still-genuinely-unmatched RWF 45,000 transaction, whose phone
  // (+250788771122) matches Alice Mukamana's account exactly.
  await targetTxn.click();

  // Scope to the immediate row (name paragraph -> its two ancestor divs) rather
  // than a broad `div` text filter, which matches every ancestor container
  // that happens to contain the name anywhere — including the whole column,
  // which also contains every other account's "Match" button.
  const mukamanaRow = page.getByText("Alice Mukamana", { exact: true }).locator("../..");
  await expect(mukamanaRow).toBeVisible();
  await mukamanaRow.getByRole("button", { name: "Match" }).click();

  // .first() — Radix Toast duplicates its message into an aria-live announcer for screen readers.
  await expect(page.getByText(/Matched RWF 45,000 to Alice Mukamana/).first()).toBeVisible();

  // The invalidated queries refetch asynchronously after the match mutation
  // settles — poll (not a single snapshot read) until the total actually
  // reflects one fewer unmatched transaction.
  await expect
    .poll(async () => {
      const text = await page.getByText(/unmatched across \d+ transactions/).textContent();
      return Number(text?.match(/across (\d+)/)?.[1] ?? "-1");
    })
    .toBe(beforeCount - 1);
});

test("expense above the approval threshold is gated in the approval queue until approved", async ({ page }) => {
  await goToCashBox(page);
  await page.getByRole("tab", { name: "Expenses" }).click();

  await page.getByLabel("Amount", { exact: true }).fill("120000"); // above the RWF 50,000 threshold
  await page.getByLabel("Payee").fill("Test Roofing Contractor");
  await expect(page.getByText(/above the RWF 50,000 approval threshold/)).toBeVisible();

  await page.getByRole("button", { name: "Send for approval" }).click();
  // .first() — Radix Toast duplicates its message into an aria-live announcer for screen readers.
  await expect(page.getByText(/sent for approval/).first()).toBeVisible();

  // Scope to the specific queue row (payee text -> its containing row div),
  // not a broad text-containing-div filter that also matches ancestors
  // holding every other pending expense's own Approve button.
  const queueRow = page.getByText("Test Roofing Contractor", { exact: false }).locator("../..");
  await expect(queueRow.getByRole("button", { name: "Approve" })).toBeVisible();
  await queueRow.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Expense approved and posted.").first()).toBeVisible();
});

test("an expense below the approval threshold posts immediately with no approval step", async ({ page }) => {
  await goToCashBox(page);
  await page.getByRole("tab", { name: "Expenses" }).click();

  await page.getByLabel("Amount", { exact: true }).fill("8000"); // below threshold
  await page.getByLabel("Payee").fill("Test Stationery Shop");
  await expect(page.getByText(/above the RWF 50,000 approval threshold/)).toHaveCount(0);

  await page.getByRole("button", { name: "Record expense" }).click();
  await expect(page.getByText(/Test Stationery Shop/).first()).toBeVisible();
  // Should never appear in the approval queue — its row has no Approve button.
  const row = page.getByText("Test Stationery Shop", { exact: false }).locator("../..");
  await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("Cash Box has no serious/critical accessibility violations", async ({ page }) => {
  await goToCashBox(page);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});
