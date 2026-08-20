import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("design route renders every component with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/design");
  await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
  await expect(page.getByText("RWF 1,240,500")).toBeVisible();

  expect(errors).toEqual([]);
});

test("design route has no horizontal overflow at this viewport", async ({ page }) => {
  await page.goto("/design");
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test("Drawer opens from the table and Confirm dialog requires typed confirmation", async ({ page }) => {
  await page.goto("/design");
  await page.getByText("Cement CIMERWA 50kg").click();
  await expect(page.getByRole("dialog").getByText("Cement CIMERWA 50kg")).toBeVisible();
  // Two "Close" buttons exist (the drawer's ✕ icon, aria-label="Close", and
  // its footer text button) — target the icon one specifically.
  await page.getByLabel("Close", { exact: true }).click();

  await page.getByRole("button", { name: "Write off debt" }).click();
  const confirmButton = page.getByRole("button", { name: "Write off debt", exact: true }).last();
  await expect(confirmButton).toBeDisabled();
  await page.getByLabel(/Type "Kigali Builders Ltd" to confirm/).fill("Kigali Builders Ltd");
  await expect(confirmButton).toBeEnabled();
});

test("design route has no serious/critical accessibility violations", async ({ page }) => {
  await page.goto("/design");
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});
