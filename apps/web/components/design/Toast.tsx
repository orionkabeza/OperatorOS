"use client";

import * as RadixToast from "@radix-ui/react-toast";
import { useToastStore } from "@/lib/toast-store";

export function ToastViewport() {
  const { toasts, dismiss } = useToastStore();

  return (
    <RadixToast.Provider duration={4000} swipeDirection="left">
      {toasts.map((toast) => (
        <RadixToast.Root
          key={toast.id}
          className="motion-safe:animate-row-fade-in flex items-center gap-16 rounded bg-steel px-16 py-12 text-white shadow-shelf"
          onOpenChange={(open) => {
            if (!open) dismiss(toast.id);
          }}
        >
          <RadixToast.Description className="text-body">{toast.message}</RadixToast.Description>
          {toast.onUndo ? (
            <RadixToast.Action asChild altText="Undo">
              <button
                type="button"
                onClick={toast.onUndo}
                className="text-table font-semibold text-tape underline underline-offset-2"
              >
                Undo
              </button>
            </RadixToast.Action>
          ) : null}
        </RadixToast.Root>
      ))}
      {/* B.6: bottom-left. */}
      <RadixToast.Viewport className="fixed bottom-24 left-24 z-50 flex w-drawer max-w-full flex-col gap-8" />
    </RadixToast.Provider>
  );
}
