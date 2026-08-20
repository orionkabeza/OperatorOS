import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAndReachCounter } from "./helpers";

async function goToDebtBook(page: import("@playwright/test").Page) {
  await signInAndReachCounter(page);
  await page.getByRole("button", { name: "Debt Book" }).click();
  await expect(page.getByRole("heading", { name: "Debt Book" })).toBeVisible();
}

test("take payment with auto-oldest-first allocation pays the older invoice first", async ({ page }) => {
  await goToDebtBook(page);

  // Jean Bosco Habimana has two open invoices: INV-2611 (RWF 900,000, older,
  // 62d overdue) and INV-2802 (RWF 945,000, 35d overdue) — a partial
  // payment should allocate to the older one first.
  await page.getByText("Jean Bosco Habimana").first().click();
  await expect(page.getByRole("button", { name: "Record payment" })).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();

  await expect(page.getByText(/Take payment — Jean Bosco Habimana/)).toBeVisible();
  await page.getByLabel("Amount").fill("500000");

  // Auto allocation preview should show the full 500,000 landing on INV-2611.
  const previewRow = page.locator("tr", { hasText: "INV-2611" });
  await expect(previewRow.getByText("500,000")).toBeVisible();

  await page.getByRole("button", { name: "Record payment", exact: true }).last().click();
  // .first() — Radix Toast duplicates its message into an aria-live announcer for screen readers, so this text legitimately appears twice.
  await expect(page.getByText(/Payment of RWF 500,000 recorded for Jean Bosco Habimana/).first()).toBeVisible();
});

test("manual allocation validates the split sums to the payment amount before it can be recorded", async ({ page }) => {
  await goToDebtBook(page);

  await page.getByText("Jean Bosco Habimana").first().click();
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(/Take payment — Jean Bosco Habimana/)).toBeVisible();

  await page.getByLabel("Amount").fill("500000");
  await page.getByRole("button", { name: "Manual per invoice" }).click();

  // Allocate only 300,000 of the 500,000 payment — should surface a validation error.
  await page.getByLabel("Allocate to INV-2611").fill("300000");
  await expect(page.getByText(/must equal the payment amount/)).toBeVisible();

  // Complete the split to exactly 500,000 — the error should clear.
  await page.getByLabel("Allocate to INV-2802").fill("200000");
  await expect(page.getByText(/must equal the payment amount/)).toHaveCount(0);
});

test("write-off above the confirmation threshold requires a reason and the typed customer name", async ({ page }) => {
  await goToDebtBook(page);

  // Kigali Builders Ltd owes RWF 1,760,000 — comfortably above the RWF
  // 500,000 typed-confirmation threshold. The write-off action lives in
  // the account drawer's Settings tab, alongside the account's other
  // status/limit fields.
  await page.getByText("Kigali Builders Ltd").first().click();
  await page.getByRole("tab", { name: "settings" }).click();
  await page.getByRole("button", { name: "Write off debt" }).click();

  const confirmButton = page.getByRole("button", { name: "Write off debt", exact: true }).last();
  await expect(confirmButton).toBeDisabled();

  // Typing the name alone isn't enough — the reason field is also required.
  await page.getByLabel(/Type "Kigali Builders Ltd" to confirm/).fill("Kigali Builders Ltd");
  await expect(confirmButton).toBeDisabled();

  // Filling the reason alone (name not yet typed) still leaves it locked.
  await page.getByLabel(/Type "Kigali Builders Ltd" to confirm/).fill("");
  await page.getByPlaceholder(/uncollectable/).fill("Customer's shop closed, uncollectable");
  await expect(confirmButton).toBeDisabled();

  // Both filled — now it unlocks.
  await page.getByLabel(/Type "Kigali Builders Ltd" to confirm/).fill("Kigali Builders Ltd");
  await expect(confirmButton).toBeEnabled();

  await confirmButton.click();
  // .first() — Radix Toast duplicates its message into an aria-live announcer for screen readers.
  await expect(page.getByText(/written off for Kigali Builders Ltd/).first()).toBeVisible();
});

test("MoMo sandbox round trip: requesting a payment settles automatically and updates the account balance", async ({ page }) => {
  await goToDebtBook(page);

  // Jean-Paul Nzeyimana owes RWF 45,000 on a single invoice — request the
  // full amount via the sandbox MoMo provider rather than entering it manually.
  await page.getByText("Jean-Paul Nzeyimana").first().click();
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(/Take payment — Jean-Paul Nzeyimana/)).toBeVisible();

  await page.getByLabel("Amount").fill("45000");
  await page.getByRole("button", { name: "MoMo", exact: true }).click();
  await expect(page.getByLabel("Customer phone")).toHaveValue("+250788333444");

  await page.getByRole("button", { name: "Request payment (sandbox)" }).click();
  // .first() — Radix Toast duplicates its message into an aria-live announcer for screen readers.
  await expect(page.getByText(/Payment request sent to \+250788333444/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Waiting for approval…" })).toBeVisible();

  // The sandbox settles ~3s later (lib/mock/store.ts) and the drawer closes itself.
  await expect(page.getByText(/Payment of RWF 45,000 received from Jean-Paul Nzeyimana via MoMo/).first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(/Take payment — Jean-Paul Nzeyimana/)).toHaveCount(0);

  // The account's balance should now read zero — the whole payment settled
  // and auto-allocated against the one open invoice. getByLabel (not
  // getByText) targets Money's own aria-label specifically — the credit-
  // limit-usage caption in the same row also contains the literal text
  // "RWF 0" ("RWF 0 / 300,000 · 0%"), which getByText would ambiguously match too.
  const row = page.locator("tr", { hasText: "Jean-Paul Nzeyimana" });
  await expect(row.getByLabel("RWF 0", { exact: true })).toBeVisible();
});

test("chase today queue lists overdue accounts and a snooze action removes one from the list", async ({ page }) => {
  await goToDebtBook(page);
  await page.getByRole("tab", { name: /Chase today/ }).click();

  const habimanaRow = page.locator("tr", { hasText: "Jean Bosco Habimana" });
  await expect(habimanaRow).toBeVisible();

  await habimanaRow.getByRole("button", { name: "Snooze" }).click();
  const dateInput = page.locator('input[type="date"]').last();
  const future = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  await dateInput.fill(future);
  await page.getByRole("button", { name: "Confirm snooze" }).click();

  await expect(page.locator("tr", { hasText: "Jean Bosco Habimana" })).toHaveCount(0);
});

test("Debt Book has no serious/critical accessibility violations", async ({ page }) => {
  await goToDebtBook(page);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});
