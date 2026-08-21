import { DEMO_MANAGER_PIN } from "../mock/seed";
import { USE_MOCK_API } from "./config";

/**
 * Manager-PIN approval for the flows that need one: a discount above
 * `DISCOUNT_MANAGER_PIN_THRESHOLD_PERCENT`, a credit-limit override, and
 * back-dating a payment.
 *
 * This lives in the API layer, not in the three components that need it,
 * because it is a mock/real branch and those are the only place branches
 * belong. Previously each component compared the typed PIN against
 * `DEMO_MANAGER_PIN` ("9999") directly, which meant that against a real
 * backend the UI reported approval and then the request failed anyway:
 * `apps/api`'s `_verify_manager_override` requires BOTH a manager user id
 * and that manager's own PIN, and `lib/api/sales.ts` always sends
 * `manager_override_user_id: null`, so the check returns False and the
 * sale comes back 422. The user saw "approved", then an error they had no
 * way to connect to it.
 *
 * So: approve in mock mode, and in real mode say plainly that the feature
 * isn't wired up rather than granting an approval the server will refuse.
 * The honest failure is the point — a local "yes" that the backend turns
 * into a "no" is worse than a clear "not yet".
 *
 * To make this real, the UI needs to name WHICH manager is approving
 * (`GET /api/v1/users` can list them) and send that id alongside the PIN.
 * See docs/DECISIONS.md.
 */
export type ManagerOverrideOutcome = { approved: true } | { approved: false; message: string };

const NOT_WIRED_UP =
  "Manager approval isn't available yet — it needs to record which manager approved, " +
  "and this screen can't ask that yet. Lower the amount, or ask an owner to make the change.";

export function verifyManagerOverridePin(pin: string): ManagerOverrideOutcome {
  if (!USE_MOCK_API) return { approved: false, message: NOT_WIRED_UP };
  return pin === DEMO_MANAGER_PIN ? { approved: true } : { approved: false, message: "Wrong PIN." };
}
