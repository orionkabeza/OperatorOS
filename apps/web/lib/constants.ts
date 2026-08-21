/**
 * Configurable-in-spec thresholds that Back Office → Settings will own for
 * real (D.10.6: "thresholds (discount approval, write-off approval,
 * variance alert, credit limits)"). Phase 1 has no Settings screen yet, so
 * these are hardcoded constants with the same shape Settings will expose —
 * swapping to a real per-business setting later is a data-source change,
 * not a logic change.
 */
export const DISCOUNT_MANAGER_PIN_THRESHOLD_PERCENT = 15;

export const VARIANCE_NOTIFY_THRESHOLD_MINOR = 10_000 * 100; // RWF 10,000

/**
 * D.4: "the whole block is hidden for non-VAT-registered businesses."
 * Onboarding Step 1 (D.2) captures a real TIN/VAT registration status, but
 * Phase 1's onboarding doesn't yet feed that into a business-profile read
 * used elsewhere — this constant stands in for it (our seeded demo
 * business is a small hardware store not VAT-registered, matching the
 * seed data's lack of a VAT config). Swap point: read from the business
 * profile once Onboarding's Step 1 data is queryable outside the wizard.
 */
export const BUSINESS_VAT_REGISTERED = false;
export const VAT_RATE_PERCENT = 18;

/**
 * D.6.4 — write-offs above this amount require the manager to type the
 * customer's exact name into ConfirmDialog's `typedConfirmation` before the
 * write-off is allowed; below it, the reason field alone is required. Same
 * "Settings will own this for real" caveat as the other thresholds above.
 */
export const WRITE_OFF_TYPED_CONFIRMATION_THRESHOLD_MINOR = 500_000 * 100; // RWF 500,000

/**
 * D.6.4 — back-dating a payment's date away from "today" is permission-
 * gated the same way the credit-limit override is, and always requires a
 * reason once unlocked. The PIN check itself lives in
 * lib/api/manager-override.ts, which owns the mock/real branch.
 */
