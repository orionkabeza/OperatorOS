import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { Button } from "./Button";

/**
 * B.6: used only for irreversible or high-value actions. States the
 * consequence in plain language with real numbers (pass that via `message`).
 * `typedConfirmation` requires the user to type it verbatim before the
 * confirm button enables — for write-offs etc. above a configurable threshold.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  typedConfirmation,
  onConfirm,
  children,
  confirmDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel: string;
  typedConfirmation?: string | undefined;
  onConfirm: () => void;
  /** Optional extra fields between the message and the typed-confirmation input — e.g. a required reason field (D.6.4 write-off flow). Kept generic rather than baking a "reason" field into this primitive, since not every confirm dialog needs one. */
  children?: React.ReactNode | undefined;
  /** Extra gate on top of the typed-confirmation check — e.g. "a reason has been entered." */
  confirmDisabled?: boolean | undefined;
}) {
  const [typed, setTyped] = useState("");
  const locked = (Boolean(typedConfirmation) && typed !== typedConfirmation) || Boolean(confirmDisabled);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-steel-deep/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-shutter -translate-x-1/2 -translate-y-1/2 rounded border-t-4 border-out bg-paper p-24 shadow-shelf">
          <Dialog.Title className="type-expanded font-display text-card-title font-bold text-ink">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mt-8 text-body text-ink">{message}</Dialog.Description>

          {children ? <div className="mt-16">{children}</div> : null}

          {typedConfirmation ? (
            <div className="mt-16 flex flex-col gap-4">
              <label
                htmlFor="confirm-typed-input"
                className="text-micro font-semibold uppercase tracking-tracked text-ink-soft"
              >
                Type &quot;{typedConfirmation}&quot; to confirm
              </label>
              <input
                id="confirm-typed-input"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="h-control rounded border border-rule bg-paper px-12 text-body focus:border-steel focus:outline-none focus:ring-2 focus:ring-tape"
              />
            </div>
          ) : null}

          <div className="mt-24 flex justify-end gap-8">
            <Dialog.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Dialog.Close>
            <Button
              variant="danger"
              disabled={locked}
              disabledReason={
                locked
                  ? confirmDisabled && (!typedConfirmation || typed === typedConfirmation)
                    ? "Fill in the required field above to continue."
                    : "Type the confirmation text exactly to continue."
                  : undefined
              }
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
