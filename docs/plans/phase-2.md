# Phase 2 — The money (plan)

**Status:** approved to proceed (per your "Phase 2 approved. Proceed"). Decisions in §0 are stated as the defaults I'm building to, documented here and in `docs/DECISIONS.md` rather than silently assumed — flag anything you want changed and I'll redirect.
**Spec refs:** D.6 Debt Book, D.7.1–D.7.5 Cash Box (D.7.6 bank reconciliation is explicitly marked "(v2)" in the spec itself — deferred), Part G security (webhooks, secrets), Part H Phase 2.
**Goal:** the Debt Book chases money on its own, the Cash Box answers "where is my money?" across till/MoMo/bank, expenses are recorded and approved, and a customer can pay a reminder link without anyone at the shop touching it. **Not** in this phase: Suppliers/POs (D.8, Phase 3), Analytics/Reports/Ask (Phase 4), EBM tax, real WhatsApp/SMS delivery, bank statement reconciliation (D.7.6, spec-deferred to v2) — noted per-section below as "deferred."

---

## 0. Decisions

### 0.1 What Phase 0/1 already scaffolded
The event registry already has every Phase 2 payload type (`events_registry.py`): `PAYMENT_RECEIVED`, `EXPENSE_RECORDED`, `MONEY_TRANSFERRED`, `MOMO_TRANSACTION_MATCHED`, `DEBT_WRITTEN_OFF`, `REMINDER_SENT`. `money_location_balance` already has working handlers for `EXPENSE_RECORDED`, `MONEY_TRANSFERRED`, `SALE_RECORDED`, `DAY_OPENED`/`DAY_CLOSED` (Phase 0/1). Phase 2 adds one new projection handler — `PAYMENT_RECEIVED` — to **both** `money_location_balance` (money moves into the till/momo/bank account) and `customer_balance` (the debt goes down), in the same transaction, same pattern as `SALE_RECORDED` already does for both projections today. `DEBT_WRITTEN_OFF` gets a `customer_balance` handler too (balance → 0, `written_off` flag). `PAYMENT_MADE` (supplier payments) stays unwired — that's D.8.4, Phase 3.

The `NotificationSender` protocol (`notifications.py`), the Celery beat app (`tasks/celery_app.py`), and the at-rest secret encryption seam (`security/crypto.py`, explicitly docstring'd as "TOTP seeds, mobile-money/EBM credentials once those land") are all reused as-is, not rebuilt.

### 0.2 Invoices are the credit-bearing sale itself — no shadow ledger
`customer_balance.py`'s docstring already flags `oldest_unpaid_at` as a Phase 1 placeholder because "there is no `invoices` table yet." Rather than introduce a second table that duplicates a fact `sales` already holds, a credit-bearing `Sale` (one with a `credit`-method payment line) **is** the invoice: `due_date_at` is computed once at sale time (`sale.occurred_at + customer.terms_days_at_sale`, snapshotted so a later change to the customer's terms doesn't retroactively move an already-issued invoice's due date) and stored on `sales`. Ageing buckets and the Invoices tab read directly from `sales` filtered to credit lines; "remaining" is `credit_minor(sale) − Σ allocations`.

Payment **allocation** (D.6.4: "auto-oldest-first or manual per invoice") is not derivable from `PaymentReceivedPayload` as it stands (no invoice reference field) and isn't a derived aggregate either — it's a record of a choice made at write time — so it doesn't belong in a projection. A new `payment_allocations` table (`business_id`, `payment_event_id`, `sale_id`, `amount_minor`) is written in the same transaction as the `PAYMENT_RECEIVED` event append, directly by the `Take payment` endpoint. Auto-allocation walks that customer's unpaid credit sales oldest-first; manual allocation takes explicit `{sale_id, amount_minor}` lines, validated to sum to the payment total and never exceed any one invoice's remaining balance.

### 0.3 Mobile money: a real provider seam, a sandbox behind it
Neither I nor you have live MTN MoMo / Airtel Money merchant credentials in this sandbox, so "mobile-money API integration" can't mean a real connection this phase. Building to the same standard as Phase 1's `NotificationSender` stub: a `MobileMoneyProvider` protocol (`request_payment`, credential connect/disconnect) with a `SandboxMomoProvider` implementation that simulates a customer approving a USSD prompt — a pending `momo_transactions` row settles a few seconds later via a Celery task, landing back through the **same signed webhook endpoint** (`POST /api/v1/momo/webhook/{provider}`) a real provider would call. That endpoint is genuinely production-shaped: HMAC signature verification, timestamp + nonce replay protection (spec Part G), per-tenant credentials via `encrypt_secret`/`decrypt_secret` — only the provider on the other end is fake. Real MTN/Airtel wiring is a later-phase seam-swap, documented in `docs/DECISIONS.md`, not a Phase 2 deliverable. "Connect now" (deferred to "Connect later" for everyone in Phase 1 onboarding) becomes real against the sandbox provider.

Reconciliation (D.7.3) runs the same auto-match engine (amount + phone + time window, confidence indicator) against `momo_transactions` regardless of whether a row came from the sandbox's simulated settlement or a manual CSV import of "transactions from the provider" — so the matching logic is real and provider-agnostic even though today's only source is fake.

### 0.4 Reminders: real scheduling and templates, stubbed last-mile delivery
The D.6.5 schedule builder, merge-field templates, quiet-hours/frequency guardrails, and approval-mode digest are all real. Delivery goes through `NotificationSender` — still console/log-backed until Phase 5's real WhatsApp Business API/SMS gateway lands (same honest "real logic, stubbed last hop" pattern as Phase 1 receipts). A reminder genuinely computes who's due, generates the templated message, and would genuinely send once Phase 5 swaps the sender — it's not faked, just not reaching a real phone yet.

### 0.5 Pay link closes the loop against the sandbox provider
A signed, single-use, expiring token (`/pay/{token}`) opens a minimal public page (no auth — the token *is* the auth, scoped to one customer/amount) that calls `SandboxMomoProvider.request_payment`. On simulated settlement it writes `PAYMENT_RECEIVED` allocated oldest-first, exactly as D.6.5 describes — proving the full loop end-to-end, just against a fake provider per §0.3.

### 0.6 Expenses: real approval workflow, stubbed OCR
D.7.4's amount/category/paid-from/payee/date/note and a manager-approval-above-threshold gate (reusing Phase 0's role/permission framework) are real. Receipt-photo OCR pre-fill needs an OCR provider we don't have credentials for either — the upload and storage are real, OCR pre-fill is a documented no-op seam (returns nothing to prefill) rather than faked results. Recurring expenses schedule via Celery and create draft `expenses` rows (not events directly — a draft can still be edited or rejected before it becomes an immutable fact).

### 0.7 Broadcast and segments reuse the reminder infrastructure
D.6.8's segments (saved filter definitions, not materialized member lists — computed live so counts are never stale) and broadcast send reuse `NotificationSender`, Celery, and the same quiet-hours/rate guardrails as D.6.5, aimed at growth instead of collections, per the spec's own framing.

### 0.8 Out of scope, explicitly
Bank statement reconciliation (D.7.6 — spec-marked "(v2)"). Suppliers/PO payments (`PAYMENT_MADE`, D.8 — Phase 3). Real WhatsApp/SMS/OCR/MoMo provider credentials (Phase 5 seam-swaps). Multi-currency.

---

## 1. Data model additions

New tables (all tenant-scoped, RLS `ENABLE`+`FORCE`, `business_id` FK):

- `sales.due_date_at` (nullable, set only for credit-bearing sales) — column addition, not a new table
- `payment_allocations` (business_id, payment_event_id, sale_id, amount_minor)
- `money_locations` (business_id, location_id, account_key, display_name, masked_account_number, kind, connection_status[manual/connected], last_synced_at) — backs D.7.1's card labels ("BANK (BK ••4192)", "Synced 4 min ago" vs "Manual")
- `momo_transactions` (business_id, provider, external_id, phone, amount_minor, direction, occurred_at, raw_payload JSONB, status[unmatched/matched/ignored])
- `momo_provider_credentials` (business_id, provider, encrypted_secret via `security/crypto.py`, status)
- `pay_links` (token, business_id, customer_id, amount_minor, allocation hint, expires_at, status[pending/paid/expired])
- `expenses` (business_id, amount_minor, category, money_location, payee, date, note, receipt_photo_url, ocr_status[not_attempted], status[draft/pending_approval/approved/rejected/posted], approved_by, event_id)
- `recurring_expenses` (business_id, template fields, interval, next_run_date)
- `reminder_schedules`, `reminder_schedule_steps` (per-business schedule config: offset, channel order, template per step/language)
- `reminder_log` (customer_id, step, channel, template_key, sent_at, delivered/read status) — the D.6.3 "Contact history" backing table, updated by `REMINDER_SENT` projection plus a `Log a call` manual entry
- `customer_segments` (business_id, name, filter_spec JSONB) — filter definitions only
- `broadcast_sends` (business_id, segment_snapshot JSONB, message, sent_at, sent_by, recipient_count, delivered_count, read_count)

**Migrations:** one Alembic migration per logical group (money_locations/sales.due_date_at → payment_allocations → momo staging/credentials/pay_links → expenses/recurring → reminders/segments/broadcast), each with a real down-migration.

---

## 2. Projections

- `customer_balance` ← add `PAYMENT_RECEIVED` (balance down), `DEBT_WRITTEN_OFF` (balance → 0, `written_off_at` set)
- `money_location_balance` ← add `PAYMENT_RECEIVED` (balance up in the target account)
- `reminder_log` ← `REMINDER_SENT`
- Nightly projection-audit job extended to recompute and diff both new handlers, same drift-detection pattern as Phase 0/1.

**Tests:** in-transaction update + rollback-on-failure tests for both new handlers; a dedicated test proving a `PAYMENT_RECEIVED` event moves money in `money_location_balance` and debt down in `customer_balance` **atomically** — one succeeding without the other is the exact class of bug Phase 1's stock race taught me to check for by construction, not just by trusting green tests.

---

## 3. API endpoints (FastAPI routers)

- `debt` — customer accounts list (ageing, limit-used), account drawer (statement/invoices/contact-history/settings tabs), `take payment` (allocation, back-dating with permission gate), write-off, "who to chase today" scored queue, reminder schedule CRUD + template preview + approval-mode digest + pause switch
- `customers` (extend Phase 1's router) — all-customers tab, segment CRUD, broadcast send
- `cashbox` — balances band, money movements table (filterable), manual "update balance", till-session tie-in (reuses Phase 1's `till` router, D.7.5 already built)
- `momo` — signed webhook receiver, reconciliation tab (matched/unmatched lists + match actions), provider connect/disconnect (sandbox), manual transaction CSV import
- `expenses` — CRUD, approve/reject, recurring-expense CRUD, receipt-photo upload
- `pay` — public token-scoped pay-link page endpoints (no tenant auth — token-scoped), settlement webhook path

**Idempotency:** `Idempotency-Key` required on all mutating endpoints (`take payment`, `write-off`, `expenses`, `momo` match actions, `broadcast send`) per the established convention. Webhook endpoints (`momo`, `pay` settlement) are idempotent on `(provider, external_id)` instead, since an external system — not our own client — controls retries there.

**Cross-tenant isolation suite:** auto-discovery picks up every new route; re-run explicitly against the full new route set before calling this phase done. The two public, unauthenticated routes (`pay/{token}`, `momo/webhook/{provider}`) get their own explicit test coverage that a wrong/expired token or an unsigned/replayed webhook is rejected — these are the two places this phase intentionally punches a hole in the normal auth wall, so they get more scrutiny, not less.

---

## 4. Frontend screens

- **Debt Book (D.6)** — header band (four figures + clickable ageing bar), customer accounts table with row actions, account drawer (Statement/Invoices/Contact history/Settings tabs), take-payment drawer (allocation UI), write-off flow (reason, above-threshold name-typing confirmation), "who to chase today" work queue, reminder schedule builder (Back Office) with live template preview, approval-mode daily digest, All customers tab + segment builder + broadcast composer
- **Cash Box (D.7)** — balances band (synced/manual stamps), money movements table, MoMo reconciliation tab (two-column match UI, confidence indicator, unmatched-total headline figure), expenses quick-record + approval queue, recurring-expense scheduler
- **Pay link page** — minimal branded, unauthenticated, mobile-first payment page (amount pre-filled, provider payment method, no app chrome)
- **Back Office additions** — MoMo "Connect now" (real against sandbox), reminder schedule/template editor, expense approval threshold setting

All built against the existing `/design` component library — no new ad-hoc primitives unless a genuine gap shows up, added to `/design` first per the established convention.

**Tests:** Vitest for new components (allocation math, ageing-bucket calculation, template merge-field rendering); Playwright e2e for take-payment-with-allocation, write-off with the confirmation gate, the MoMo sandbox round-trip (request → simulated settle → reconciliation match), pay-link end-to-end, expense record → approval → post; axe pass on Debt Book/Cash Box at the three standard viewports.

---

## 5. Definition of done for Phase 2

- [ ] A credit sale's due date is set at sale time and doesn't move if the customer's terms change later
- [ ] Taking a payment against a customer with multiple open invoices allocates correctly (auto-oldest-first and manual), and the same event atomically moves money in the Cash Box and debt down in the Debt Book
- [ ] Write-off requires the permission gate and (above threshold) typed confirmation, and appears as a loss with the customer still visible and chip-marked
- [ ] The reminder engine computes a correct due queue against real schedule config, respects quiet-hours/frequency guardrails, and (in approval mode) requires an explicit send
- [ ] A pay link, opened and paid against the sandbox MoMo provider, writes a real `PAYMENT_RECEIVED` and updates both the Debt Book and Cash Box
- [ ] The MoMo webhook endpoint rejects an unsigned or replayed call; reconciliation correctly auto-matches on amount+phone+time-window and exposes unmatched transactions with the correct actions
- [ ] An expense above the approval threshold cannot post without manager approval; a below-threshold one posts immediately
- [ ] Cross-tenant isolation suite passes against every new route, including explicit rejection tests for the two public unauthenticated routes
- [ ] `docs/RUNBOOK.md`/`docs/DECISIONS.md` updated; accessibility floor met; strings externalised

## 6. Execution approach

Same split as Phase 0/1: backend (data model, projections, endpoints, tests) as a background agent in an isolated worktree explicitly checked out from `rebuild/phase-2` (not `main` — the worktree-defaults-to-main gotcha from Phase 1 is now a known trap, agents get the explicit `git fetch && git checkout -B` instruction up front this time); frontend done directly by me against the backend's OpenAPI contract; merged and independently re-verified myself before merging, not just trusted from the agent's report — re-running the test suite and reading the money-atomicity and webhook-security code directly, the same discipline that caught the overselling race and the bundle-budget miss in Phase 1. Small conventional commits per section (money_locations/payment_allocations → debt book backend → cash box/momo backend → expenses/reminders backend → debt book UI → cash box UI → pay link → reminder/broadcast UI), pushed to `rebuild/phase-2` off `rebuild/phase-1`.

---

Proceeding now — branching `rebuild/phase-2`, starting the backend agent on §1–3, beginning Debt Book/Cash Box UI scaffolding myself.
