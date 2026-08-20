import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";

/**
 * `max-w-full` (added in Phase 2): the `w-drawer`/`w-drawer-lg` tokens are
 * literal pixel widths (480px/720px, per B.6) with no built-in viewport
 * cap. `max-width: 100%` resolves against the initial containing block for
 * a `position: fixed` element — i.e. the real viewport — so this correctly
 * shrinks the drawer to fit narrow screens instead of overflowing off the
 * left edge (a genuine, pre-existing bug affecting every `size="detail"`
 * drawer at ≤720px width, including Phase 1's Product Detail drawer; found
 * building Phase 2's Account Drawer when a real Playwright click on a
 * far-left "Write off debt" button failed at the 375px viewport project
 * because the button was rendered off-screen).
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  size = "default",
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  size?: "default" | "detail";
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* scrim: --steel-deep at 40% — B.6 */}
        <Dialog.Overlay className="fixed inset-0 z-40 bg-steel-deep/40" />
        <Dialog.Content
          className={clsx(
            "fixed inset-y-0 right-0 z-40 flex h-screen max-w-full flex-col border-l border-rule bg-paper",
            "motion-safe:data-[state=open]:animate-drawer-slide-in",
            size === "detail" ? "w-drawer-lg" : "w-drawer",
          )}
        >
          <div className="flex items-center justify-between border-b border-rule p-24">
            <Dialog.Title className="type-expanded font-display text-card-title font-bold text-ink">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded text-ink-soft hover:text-ink focus-visible:outline-none"
            >
              ✕
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-24">{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-8 border-t border-rule p-24">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
