# legacy/

The prior OperatorOS: a Next.js/Prisma WhatsApp order-intake dashboard for a single-location food vendor, live at operatoros.orion-labs.dev (demo tenant "Auntie Efua's Kitchen", disposable data).

This is reference-only. The rebuild targets a structurally different problem (basket-based retail POS + inventory + debt book) on a different architecture (event ledger, Part E of `OperatorOS-Spec.md`) and does not extend this code or its database. See `docs/DECISIONS.md`.

Still deployed independently from `main` via `.github/workflows/deploy.yml` — nothing here changes until a deliberate cutover decision. To run it locally, `cd legacy && npm install` (dependencies were not reinstalled here; `node_modules`/`.next` at the repo root are stale from before the move and can be deleted).
