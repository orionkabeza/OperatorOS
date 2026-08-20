import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const DEMO_PHONE = "788 402 219";
const DEMO_PIN = "142857";
const DEMO_CODE = "000000";

async function typeIntoPinBoxes(page: import("@playwright/test").Page, digits: string) {
  const boxes = await page.locator('[aria-label^="PIN digit"]').all();
  for (let i = 0; i < boxes.length; i++) {
    const digit = digits[i];
    if (digit) await boxes[i]?.type(digit);
  }
}

test("full sign-in flow: shutter -> two-factor -> Shop Floor -> room switch", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open up" })).toBeVisible();

  await page.fill("#shutter-phone", DEMO_PHONE);
  await typeIntoPinBoxes(page, DEMO_PIN);
  await page.getByRole("button", { name: "Raise the shutter" }).click();

  await expect(page.getByText("We sent a code to")).toBeVisible();
  await typeIntoPinBoxes(page, DEMO_CODE);
  await page.getByRole("button", { name: "Confirm code" }).click();

  await expect(page.getByRole("heading", { name: "Counter" })).toBeVisible();
  await expect(page.getByText("TAKEN TODAY")).toBeVisible();

  await page.getByRole("button", { name: "Debt Book" }).click();
  await expect(page.getByRole("heading", { name: "Debt Book" })).toBeVisible();
  await expect(page.getByText("No one owes you anything right now")).toBeVisible();

  expect(errors).toEqual([]);
});

test("wrong PIN shows an error without revealing the attempt threshold on the first try", async ({ page }) => {
  await page.goto("/");
  await page.fill("#shutter-phone", DEMO_PHONE);
  await typeIntoPinBoxes(page, "000000");
  await page.getByRole("button", { name: "Raise the shutter" }).click();
  await expect(page.getByText("That PIN doesn't match this number.")).toBeVisible();
  await expect(page.getByText(/tries left/)).toHaveCount(0);
});

test("shutter has no horizontal overflow at this viewport", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test("shutter has no serious/critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});
