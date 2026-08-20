import clsx from "clsx";

export function Card({
  title,
  eyebrow,
  children,
  className,
}: {
  title?: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded border border-rule bg-paper p-24 shadow-shelf",
        className,
      )}
    >
      {eyebrow ? (
        <p className="mb-4 text-micro font-semibold uppercase tracking-tracked text-ink-soft">
          {eyebrow}
        </p>
      ) : null}
      {title ? (
        <h3 className="type-expanded mb-12 font-display text-card-title font-bold text-ink">
          {title}
        </h3>
      ) : null}
      {children}
    </div>
  );
}
