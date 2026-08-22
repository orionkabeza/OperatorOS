import { Button } from "../design/Button";
import { Card } from "../design/Card";
import { KeptOnThisDevice } from "./KeptOnThisDevice";
import type { OnboardingState } from "@/lib/api/types";

/**
 * D.2 completion — summary card, then "Open the shop" runs the first day-open
 * (D.3). Only the product count describes something that actually exists
 * server-side: the CSV/XLSX importer writes real products. The rest is
 * this browser's notes, and this card says which is which rather than
 * reporting all four as done. See KeptOnThisDevice.
 */
export function StepComplete({ state, onOpenShop }: { state: OnboardingState; onOpenShop: () => void }) {
  const staffCount = state.staff.length;
  const debtorCount = state.openingBalances.debtors?.length ?? 0;

  return (
    <div className="flex flex-col gap-16">
      <p className="text-body text-ink-soft">The shop is fitted out. Here&apos;s what&apos;s in place:</p>
      <Card eyebrow="Business" title={state.business.tradingName || "Untitled business"}>
        <p className="text-meta text-ink-soft">{state.business.businessType?.replace(/_/g, " ") ?? "Not set"}</p>
      </Card>
      <Card eyebrow="Products">
        <p className="text-body text-ink">{state.productsAdded} products added</p>
      </Card>
      <Card eyebrow="Team">
        <p className="text-body text-ink">{staffCount} staff noted</p>
      </Card>
      <Card eyebrow="Books">
        <p className="text-body text-ink">{debtorCount} opening debtors noted</p>
      </Card>
      {staffCount > 0 || debtorCount > 0 ? (
        <KeptOnThisDevice>
          Your products are saved to the shop. The team list and opening debtors are notes in this browser only — no
          accounts were created, and the Debt Book opens empty.
        </KeptOnThisDevice>
      ) : null}
      <Button variant="primary" onClick={onOpenShop} className="self-start">
        Open the shop
      </Button>
    </div>
  );
}
