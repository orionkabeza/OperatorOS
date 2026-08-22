/**
 * Several setup steps collect real information that currently has nowhere to
 * go: there is no onboarding endpoint (docs/DECISIONS.md, known gaps #16), so
 * the trading name, the staff list and the opening balances are written to
 * this browser's localStorage and to nothing else. No business is renamed, no
 * account is created, no invite is sent, and no debtor reaches the Debt Book.
 *
 * That gap is disclosed and deliberate. Letting the screen imply otherwise is
 * not: step 5 collects money the shop is owed, and a shopkeeper who believes
 * those debts are on the books will not chase them. Every step whose input
 * stops here says so, in the step itself, next to the field.
 */
export function KeptOnThisDevice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border-l-3 border-watch bg-floor px-12 py-8 text-meta text-ink-soft">
      <span className="font-semibold text-watch">Kept on this device.</span> {children}
    </p>
  );
}
