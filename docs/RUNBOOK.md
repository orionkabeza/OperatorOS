# Runbook

How to run and operate OperatorOS locally. Written so a new engineer can get moving without asking anyone.

## Frontend (`apps/web`)

### Prerequisites

- Node.js 20+ (developed against Node 24)
- From the repo root: `npm install` (this is an npm workspaces monorepo — `apps/web` and `packages/shared` are installed together from the root; don't run `npm install` inside `apps/web` alone)

### Run it

```
npm run dev:web
```

Opens on `http://localhost:3000` by default. Sign in at `/` with the demo credentials (see below); `/design` shows the full component library without needing to sign in.

**Demo sign-in is not real auth.** `apps/web/lib/demo-auth-store.ts` exists purely so the Shutter's states and the Shop Floor shell are visible before `apps/api`'s real auth (Argon2id, rotating refresh tokens, TOTP) exists and is wired up — see `docs/DECISIONS.md`. Demo credentials: phone `788 402 219`, PIN `142857`, 2FA code `000000`. That file must be deleted, not extended, once real auth lands.

### Checks

Run these before every commit — all four must be clean:

```
npm run typecheck:web
npm run lint:web          # next lint + the custom no-arbitrary-Tailwind-value gate
npm run build:web
```

```
cd apps/web
npm run test               # Vitest unit tests (design system components)
npm run test:e2e           # Playwright — full sign-in flow, /design smoke, overflow, axe a11y
```

**Verifying the CSP / hydration for real:** always test against a clean production build, never a build directory that's been touched by `next dev` in between. A `.next` directory that mixes dev-mode and production artifacts serves broken assets and spurious CSP violations that look like real bugs but aren't (see the CSP-related entries in `docs/DECISIONS.md` for a worked example — it cost real debugging time once already). The pattern that's actually safe:

```
cd apps/web
rm -rf .next
npm run build
npm run start -- -p 3100
# now test against http://127.0.0.1:3100 — a curl 200 does not prove the page
# hydrates; open it in a real browser (or drive it with Playwright) and check
# the console, not just the HTTP status.
```

`npm run test:e2e` does this correctly on its own (its `webServer` config always runs a fresh `build` before `start`) — the manual steps above are for when you're debugging a CSP/hydration issue directly and want tighter control over what's running.

### Design tokens

Everything in `tailwind.config.ts` — colors, type scale, spacing, sizing — comes from `OperatorOS-Spec.md` Part B. If you need a size or color that isn't already a token, add it to the config; don't reach for an arbitrary Tailwind value (`text-[#hex]`, `p-[13px]`) — `npm run lint:web` will fail the build if you do (`apps/web/scripts/check-no-arbitrary-tailwind.mjs`).

---

*(Backend section: apps/api — Docker Compose, migrations, seeding, and the test suite — lands alongside the backend implementation.)*
