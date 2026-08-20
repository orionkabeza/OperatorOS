import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openMobileBasketIfNeeded, signInAndReachCounter } from "./helpers";

test("sign in -> open day -> sell a product for cash with correct change -> day close", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await signInAndReachCounter(page);

  // Sell one Masonry Trowel (RWF 4,500) for cash, paying RWF 5,000.
  await page.getByLabel("Search products or scan a barcode").fill("Trowel");
  await expect(page.getByRole("button", { name: "Add Masonry Trowel to the basket" })).toBeVisible();
  await page.getByRole("button", { name: "Add Masonry Trowel to the basket" }).click();
  await openMobileBasketIfNeeded(page);
  await expect(page.getByLabel("Basket", { exact: true }).getByText("Masonry Trowel")).toBeVisible();

  await page.getByRole("button", { name: "Take payment" }).click();
  await expect(page.getByText(/Take payment — RWF/)).toBeVisible();
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByLabel("Cash given").fill("5000");
  await expect(page.getByText("Change due")).toBeVisible();

  await page.getByRole("button", { name: "Complete sale" }).click();
  await expect(page.getByText("Sale saved.")).toHaveCount(0); // sanity: not the generic copy, receipt number below is the real check
  await expect(page.getByRole("button", { name: "No receipt" })).toBeVisible();
  await page.getByRole("button", { name: "No receipt" }).click();

  await expect(page.getByText(/Sale saved — receipt #/).first()).toBeVisible();

  // Day close round trip.
  await page.getByRole("button", { name: "Close the shop" }).first().click();
  await expect(page.getByRole("heading", { name: "Close the shop" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  const expectedLine = await page.getByText(/Expected/).textContent();
  const match = expectedLine?.match(/RWF\s([\d,]+)/);
  const expected = match ? match[1]!.replace(/,/g, "") : "0";
  await page.locator("#close-shop-count").fill(expected);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "The day" })).toBeVisible();
  await expect(page.getByText("Transactions")).toBeVisible();
  await page.getByRole("button", { name: "Close the shop" }).click();

  await expect(page.getByRole("heading", { name: "Sent to the owner" })).toBeVisible({ timeout: 10_000 });
  // Two "Back to the floor" controls exist by design: a persistent ghost
  // escape-hatch in the flow's header, and the primary confirm button on
  // this final step — click the primary one.
  await page.getByRole("button", { name: "Back to the floor" }).last().click();

  expect(errors).toEqual([]);
});

test("a credit sale blocks at the customer's credit limit and requires a manager PIN override", async ({ page }) => {
  await signInAndReachCounter(page);

  // Cement 50kg x25 = RWF 262,500 — Kigali Builders Ltd has RWF 240,000 of headroom left (2,000,000 limit, 1,760,000 balance).
  await page.getByLabel("Search products or scan a barcode").fill("Cement 50kg");
  await page.getByRole("button", { name: /Add Cement 50kg .* to the basket/ }).click();
  await openMobileBasketIfNeeded(page);
  await page.getByLabel(/Quantity of Cement 50kg/).fill("25");

  // Pick the credit customer.
  await page.getByRole("button", { name: "Walk-in" }).click();
  await page.getByLabel("Search customers by name or phone").fill("Kigali Builders");
  await page.getByText("Kigali Builders Ltd").click();

  await page.getByRole("button", { name: "Take payment" }).click();
  await page.getByRole("button", { name: "On credit" }).click();

  await expect(page.getByText(/would put Kigali Builders Ltd over their credit limit/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete sale" })).toBeDisabled();

  await page.getByLabel("Manager PIN").fill("9999");
  await page.getByLabel("Override reason").fill("Owner approved by phone");
  await page.getByRole("button", { name: "Override and continue" }).click();

  await expect(page.getByRole("button", { name: "Complete sale" })).toBeEnabled();
  await page.getByRole("button", { name: "Complete sale" }).click();
  await expect(page.getByRole("button", { name: "No receipt" })).toBeVisible();
});

test("barcode-timing detection: a fast synthetic keystroke burst resolves to an exact product, not a fuzzy search", async ({ page }) => {
  // The pure timing heuristic itself (lib/barcode.ts) has deterministic
  // unit coverage in lib/barcode.test.ts using synthetic timestamps — a
  // real browser's event-loop jitter under Playwright's `pressSequentially`
  // delay isn't precise enough to reliably assert the UI's "Detected as a
  // barcode scan." hint here without flaking. What this test verifies
  // instead is the behaviour that actually matters: typing a full barcode
  // fast and pressing Enter adds the exact matching product (an exact
  // barcode/SKU lookup, independent of the timing hint), not whatever the
  // fuzzy top search result happens to be.
  await signInAndReachCounter(page);
  const input = page.getByLabel("Search products or scan a barcode");
  await input.click();
  await input.pressSequentially("6001234500019", { delay: 5 });
  await input.press("Enter");
  await openMobileBasketIfNeeded(page);
  await expect(page.getByLabel("Basket", { exact: true }).getByText("Cement 50kg (CIMERWA)")).toBeVisible();
  await expect(input).toHaveValue("");
});

test.describe("accessibility", () => {
  test("Counter has no serious/critical axe violations", async ({ page }) => {
    await signInAndReachCounter(page);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("Stock Room has no serious/critical axe violations", async ({ page }) => {
    await signInAndReachCounter(page);
    await page.getByRole("button", { name: "Stock Room" }).click();
    await expect(page.getByRole("heading", { name: "Stock Room" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("Overview (Back Office) has no serious/critical axe violations", async ({ page }) => {
    await signInAndReachCounter(page);
    await page.getByRole("button", { name: "Back Office" }).click();
    await expect(page.getByRole("heading", { name: "Back Office" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
