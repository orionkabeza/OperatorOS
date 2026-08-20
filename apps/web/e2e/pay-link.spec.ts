import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("pay link renders with no app chrome, the amount pre-filled, and pays end to end against the sandbox provider", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/pay/demo-pay-kigali");

  // No app shell: no room nav, no top nav.
  await expect(page.getByRole("navigation", { name: "Rooms" })).toHaveCount(0);

  await expect(page.getByText("Kigali Hardware Supplies")).toBeVisible();
  await expect(page.getByText(/Payment request for Kigali Builders Ltd/)).toBeVisible();
  // The amount legitimately appears twice (the big tally display and inside
  // the "Pay RWF 560,000" button's own label) — .first() targets the display.
  await expect(page.getByText("560,000").first()).toBeVisible();

  await page.getByRole("button", { name: "MTN MoMo" }).click();
  await page.getByLabel("Your phone number").fill("0788111222");
  await page.getByRole("button", { name: /^Pay/ }).click();

  await expect(page.getByText("Check your phone")).toBeVisible();
  await expect(page.getByText("Payment received", { exact: false }).first()).toBeVisible({ timeout: 10_000 });

  expect(errors).toEqual([]);
});

test("an unknown pay-link token shows an honest 'not found' state, not a crash", async ({ page }) => {
  await page.goto("/pay/this-token-does-not-exist");
  await expect(page.getByText("Link not found")).toBeVisible();
});

test("pay link page has no serious/critical accessibility violations", async ({ page }) => {
  await page.goto("/pay/demo-pay-kigali");
  await expect(page.getByText("Kigali Hardware Supplies")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});
