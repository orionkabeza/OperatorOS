import { create } from "zustand";

export interface ToastItem {
  id: string;
  message: string;
  onUndo?: () => void;
  /**
   * Overrides the Provider's 4s default (B.6's general rule) for a specific
   * toast — D.4 calls out a 20s window specifically for the post-sale
   * "Undo" toast, longer than the generic default since reversing a
   * completed sale is a bigger decision than dismissing an info toast.
   */
  durationMs?: number;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

/**
 * B.6: text matches the button that caused it ("Save sale" → "Sale saved."),
 * 4s auto-dismiss, optional Undo where the action is reversible. Never green
 * — Toast.tsx enforces the steel/white styling regardless of what triggered it.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id: crypto.randomUUID() }],
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
