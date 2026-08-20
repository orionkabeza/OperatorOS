import { create } from "zustand";

/** Tiny UI-only store so TopNav's "Close my till" trigger and TillSessionModal (nested deeper in the tree) can share one boolean without prop-drilling through ShopFloor. */
export const useTillUiStore = create<{ closeRequested: boolean; requestClose: () => void; cancelClose: () => void }>((set) => ({
  closeRequested: false,
  requestClose: () => set({ closeRequested: true }),
  cancelClose: () => set({ closeRequested: false }),
}));
