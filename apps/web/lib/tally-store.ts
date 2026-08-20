import { create } from "zustand";
import { minorUnits, type MinorUnits } from "@operatoros/shared";

export type TallyKey = "taken" | "credit" | "till" | "stock";

interface TallyState {
  takenToday: MinorUnits;
  onCreditToday: MinorUnits;
  inTheTill: MinorUnits;
  lowStockCount: number;
}

/**
 * B.5.2: live figures on the Tally Rail. Phase 0 has no sales/stock features
 * yet, so this is genuinely empty (all zero) rather than faked — "live
 * (empty)" per the Phase 0 deliverable, not a placeholder screenshot. Once
 * the event ledger has real projections, this store's values get replaced
 * by a query against them instead of being hardcoded at zero.
 */
export const useTallyStore = create<TallyState>(() => ({
  takenToday: minorUnits(0),
  onCreditToday: minorUnits(0),
  inTheTill: minorUnits(0),
  lowStockCount: 0,
}));
