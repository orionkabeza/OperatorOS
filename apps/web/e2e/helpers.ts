import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

const DEMO_PHONE = "788 402 219";
const DEMO_PIN = "142857";
const DEMO_CODE = "000000";

export async function typeIntoPinBoxes(page: Page, digits: string) {
  const boxes = await page.locator('[aria-label^="PIN digit"]').all();
  for (let i = 0; i < boxes.length; i++) {
    const digit = digits[i];
    if (digit) await boxes[i]?.type(digit);
  }
}

export async function signIn(page: Page) {
  await page.goto("/");
  await page.fill("#shutter-phone", DEMO_PHONE);
  await typeIntoPinBoxes(page, DEMO_PIN);
  await page.getByRole("button", { name: "Raise the shutter" }).click();
  await expect(page.getByText("We sent a code to")).toBeVisible();
  await typeIntoPinBoxes(page, DEMO_CODE);
  await page.getByRole("button", { name: "Confirm code" }).click();
}

/** Every fresh browser context starts with no onboarding state — this walks the minimum path (Step 1 required, 2-5 skipped) to reach the Shop Floor. */
export async function completeOnboarding(page: Page) {
  await expect(page.getByRole("heading", { name: "Fitting out the shop" })).toBeVisible();
  await page.getByLabel("Trading name").fill("Kigali Hardware Supplies");
  await page.getByLabel("Business type").selectOption("hardware_store");
  await page.getByRole("button", { name: "Continue" }).click();
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Skip this step" }).click();
  }
  await expect(page.getByRole("button", { name: "Open the shop" })).toBeVisible();
}

/** Opens the day via the D.3 modal, using the expected till amount so variance is zero (no reason field needed). */
export async function openShop(page: Page) {
  await page.getByRole("button", { name: "Open the shop" }).click();
  await expect(page.getByText(/Open the shop —/)).toBeVisible();
  const closedLine = await page.getByText(/Closed yesterday with/).textContent();
  const match = closedLine?.match(/RWF\s([\d,]+)/);
  const expected = match ? match[1]!.replace(/,/g, "") : "340500";
  await page.locator("#open-shop-count").fill(expected);
  await page.getByRole("button", { name: "Open the shop", exact: true }).click();
  await expect(page.getByText(/Open the shop —/)).toHaveCount(0);
}

/**
 * Dismisses the till-open prompt that appears right after the day opens.
 * TillSessionModal only mounts once its `useDayStatus`/`useTillSession`
 * queries resolve (a real, if short, async gap after the day-open mutation
 * settles) — an instant, non-waiting visibility check here raced that gap
 * and sometimes missed a modal that appeared a beat later, leaving it open
 * and covering the Counter for the rest of the test. Actively waiting (with
 * a bounded timeout, since the modal is genuinely optional) fixes it for real.
 */
export async function skipTillOpen(page: Page) {
  const notYet = page.getByRole("button", { name: "Not yet" });
  try {
    await notYet.waitFor({ state: "visible", timeout: 3_000 });
    await notYet.click();
  } catch {
    // No till-open prompt appeared within the window — nothing to dismiss.
  }
}

/** Below the lg breakpoint (1280px, spec D.4's own "three columns on desktop (≥1280px)" threshold) the basket lives in a bottom-sheet Drawer, not an inline column — open it before interacting with basket contents. */
export async function openMobileBasketIfNeeded(page: Page) {
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 1280) {
    await page.getByRole("button", { name: "Open basket" }).click();
  }
}

export async function signInAndReachCounter(page: Page) {
  await signIn(page);
  await completeOnboarding(page);
  await openShop(page);
  await skipTillOpen(page);
  await expect(page.getByRole("heading", { name: "Counter" })).toBeVisible();
}
