import { Button } from "../design/Button";
import { Card } from "../design/Card";
import type { OnboardingState } from "@/lib/api/types";

/** D.2 completion — summary card, then "Open the shop" runs the first day-open (D.3). */
export function StepComplete({ state, onOpenShop }: { state: OnboardingState; onOpenShop: () => void }) {
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
        <p className="text-body text-ink">{state.staff.length} staff invited</p>
      </Card>
      <Card eyebrow="Books">
        <p className="text-body text-ink">{state.openingBalances.debtors?.length ?? 0} opening debtors recorded</p>
      </Card>
      <Button variant="primary" onClick={onOpenShop} className="self-start">
        Open the shop
      </Button>
    </div>
  );
}
