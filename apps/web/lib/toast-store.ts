import { create } from "zustand";

export interface ToastItem {
  id: string;
  message: string;
  onUndo?: () => void;
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
