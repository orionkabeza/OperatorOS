import { Button } from "./Button";

/** Never a shrug — B.6: one line of what lives here, plus the primary action. */
export function EmptyState({
  statement,
  actionLabel,
  onAction,
}: {
  statement: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-16 rounded border border-rule bg-paper p-48 shadow-shelf">
      <p className="max-w-prose text-body text-ink-soft">{statement}</p>
      {actionLabel && onAction ? (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
