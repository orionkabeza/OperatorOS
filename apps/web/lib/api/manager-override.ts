import { DEMO_MANAGER_PIN } from "../mock/seed";
import { apiRequest, USE_MOCK_API } from "./config";

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
export type ManagerOverrideOutcome =
  | { approved: true; managerUserId: string | null }
  | { approved: false; message: string };

export interface Approver {
  id: string;
  displayName: string;
}

/** Capability keys apps/api checks for each override (capabilities.py). */
export const OVERRIDE_CAPABILITIES = {
  discount: "sale.discount.over_threshold",
  priceOverride: "sale.price_override",
  creditLimit: "debt.credit_override",
} as const;

/**
 * Who can approve a given override. `GET /api/v1/users` can't answer this
 * for a cashier — it needs `user.manage`, which cashiers deliberately lack
 * — so apps/api grew `GET /api/v1/users/approvers`, which returns just an
 * id and a display name for the users holding that one capability.
 */
export async function listApprovers(capability: string): Promise<Approver[]> {
  if (USE_MOCK_API) {
    return [{ id: "user-manager-demo", displayName: "Manager (demo)" }];
  }
  const raw = await apiRequest<{ id: string; display_name: string }[]>(
    "GET",
    "/api/v1/users/approvers",
    { query: { capability } },
  );
  return raw.map((a) => ({ id: a.id, displayName: a.display_name }));
}

/**
 * Checks a manager's PIN locally in mock mode; against a real backend the
 * PIN is never verified here at all — it is carried with the request and
 * checked server-side by `_verify_manager_override`, which is the only
 * place that can verify it (the hash lives in the database, and the check
 * is rate-limited there).
 *
 * The old shape compared the typed PIN to `DEMO_MANAGER_PIN` in three
 * components, so real mode reported approval and the sale then came back
 * 422 — apps/api requires the approving manager's *user id* too, and
 * `sales.ts` sent null. Returning the id alongside the approval is what
 * lets the caller actually send it.
 */
export function verifyManagerOverridePin(pin: string, managerUserId?: string): ManagerOverrideOutcome {
  if (USE_MOCK_API) {
    return pin === DEMO_MANAGER_PIN
      ? { approved: true, managerUserId: null }
      : { approved: false, message: "Wrong PIN." };
  }
  if (!managerUserId) return { approved: false, message: "Choose which manager is approving." };
  if (!pin.trim()) return { approved: false, message: "Enter the manager's PIN." };
  // Server-verified: a wrong PIN surfaces as the request's own error.
  return { approved: true, managerUserId };
}
