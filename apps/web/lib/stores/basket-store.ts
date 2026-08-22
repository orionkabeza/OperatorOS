import { minorUnits, type MinorUnits } from "@operatoros/shared";
import { create } from "zustand";
import { addQty } from "../decimal";
import type { BasketLineInput } from "../api/types";

export interface BasketLine extends BasketLineInput {
  /** Stable client-side id so two lines of the same product+unit (e.g. one at list price, one discounted) can coexist. */
  lineId: string;
  note?: string;
}

interface DiscountState {
  mode: "percent" | "amount";
  value: number; // percent (0-100) or minor units, depending on mode
  managerPinVerified: boolean;
  /**
   * Carried through to the sale. apps/api's `_verify_manager_override`
   * needs BOTH the approving manager's user id and their PIN -- verifying
   * only a boolean here is what made every over-threshold discount fail
   * 422 against the real backend while passing against the mock.
   */
  managerPin?: string;
  managerUserId?: string | null;
}

interface BasketState {
  lines: BasketLine[];
  customerId: string | null;
  discount: DiscountState;
  activeParkedTabId: string | null;

  addLine: (input: Omit<BasketLineInput, "lineDiscountMinor"> & { lineDiscountMinor?: MinorUnits }) => void;
  removeLine: (lineId: string) => void;
  setQty: (lineId: string, qty: string) => void;
  setUnitPrice: (lineId: string, unitPriceMinor: MinorUnits) => void;
  setLineDiscount: (lineId: string, discountMinor: MinorUnits) => void;
  setLineNote: (lineId: string, note: string) => void;
  setLineUnit: (lineId: string, unitId: string, unitPriceMinor: MinorUnits) => void;
  setCustomer: (customerId: string | null) => void;
  setDiscount: (discount: Partial<DiscountState>) => void;
  clear: () => void;
  loadParked: (lines: BasketLine[], customerId: string | null, parkedTabId: string) => void;
}

function newLineId() {
  return `line-${crypto.randomUUID()}`;
}

export const useBasketStore = create<BasketState>((set, get) => ({
  lines: [],
  customerId: null,
  discount: { mode: "percent", value: 0, managerPinVerified: false, managerUserId: null },
  activeParkedTabId: null,

  addLine: (input) => {
    const existing = get().lines.find((l) => l.productId === input.productId && l.unitId === input.unitId && !input.note);
    if (existing) {
      set({
        lines: get().lines.map((l) => (l.lineId === existing.lineId ? { ...l, qty: addQty(l.qty, input.qty) } : l)),
      });
      return;
    }
    const line: BasketLine = {
      lineId: newLineId(),
      productId: input.productId,
      name: input.name,
      qty: input.qty,
      unitId: input.unitId,
      unitPriceMinor: input.unitPriceMinor,
      lineDiscountMinor: input.lineDiscountMinor ?? minorUnits(0),
    };
    set({ lines: [...get().lines, line] });
  },

  removeLine: (lineId) => set({ lines: get().lines.filter((l) => l.lineId !== lineId) }),

  setQty: (lineId, qty) => set({ lines: get().lines.map((l) => (l.lineId === lineId ? { ...l, qty } : l)) }),

  setUnitPrice: (lineId, unitPriceMinor) =>
    set({ lines: get().lines.map((l) => (l.lineId === lineId ? { ...l, unitPriceMinor } : l)) }),

  setLineDiscount: (lineId, lineDiscountMinor) =>
    set({ lines: get().lines.map((l) => (l.lineId === lineId ? { ...l, lineDiscountMinor } : l)) }),

  setLineNote: (lineId, note) => set({ lines: get().lines.map((l) => (l.lineId === lineId ? { ...l, note } : l)) }),

  setLineUnit: (lineId, unitId, unitPriceMinor) =>
    set({ lines: get().lines.map((l) => (l.lineId === lineId ? { ...l, unitId, unitPriceMinor } : l)) }),

  setCustomer: (customerId) => set({ customerId }),

  setDiscount: (discount) => set({ discount: { ...get().discount, ...discount } }),

  clear: () =>
    set({
      lines: [],
      customerId: null,
      discount: { mode: "percent", value: 0, managerPinVerified: false, managerUserId: null },
      activeParkedTabId: null,
    }),

  loadParked: (lines, customerId, parkedTabId) => set({ lines, customerId, activeParkedTabId: parkedTabId }),
}));
