# Phase 1 — The shop (plan)

**Status:** approved to proceed (per your "Phase 1 approved. Proceed"). Decisions in §0 are stated as the defaults I'm building to, documented here and in `docs/DECISIONS.md` rather than silently assumed — flag anything you want changed and I'll redirect.
**Spec refs:** D.2 Onboarding, D.3 Day open, D.4 Counter, D.5 Stock Room, D.7.5 Till sessions, D.10.1 Overview, D.11 Day close, Part H Phase 1.
**Goal:** a real, sellable POS — a cashier can sign in, open the day, sell products for cash/manual mobile money/credit, the stock count and till balance move for real, the day closes and reconciles, and the owner has a one-screen Overview. **Not** in this phase: Debt Book statements/reminders, mobile-money API push/reconciliation, expenses, full Cash Box, Suppliers/POs, Analytics/Reports/Ask, EBM tax, WhatsApp surface — all explicitly later phases per spec Part H, noted per-section below as "deferred."

---

## 0. Decisions

### 0.1 What Phase 0 already scaffolded
The backend agent's Phase 0 work already defined the **full event-type registry** for the whole product (`apps/api/src/operatoros_api/events_registry.py`) — every payload type through Phase 5 is already a validated Pydantic model, append-tested. Phase 1 does not add new event types; it adds the **entity tables, projections, and API endpoints** that make the Phase-1-relevant subset of that registry real, and the UI that drives it. This is a meaningfully smaller lift than it looks from the spec text alone, and it means the append layer for these events is already tested — Phase 1 tests focus on the new projections, entities, and endpoints.

**Events wired for real this phase:** `DAY_OPENED`, `DAY_CLOSED`, `TILL_SESSION_OPENED`, `TILL_SESSION_CLOSED`, `SALE_RECORDED`, `SALE_REVERSED`, `QUOTE_ISSUED`, `QUOTE_CONVERTED`, `RETURN_RECORDED`, `STOCK_RECEIVED`, `STOCK_ISSUED`, `STOCK_ADJUSTED`, `STOCK_TRANSFERRED_OUT/IN`, `STOCK_WRITTEN_OFF`, `STOCKTAKE_POSTED`, `CUSTOMER_CREATED`, `CREDIT_LIMIT_CHANGED`, `PRICE_CHANGED`, `PRODUCT_CREATED`, `PRODUCT_ARCHIVED`.

**Deferred (registry exists, no projection/UI yet, later phase noted):** `PAYMENT_RECEIVED`/`PAYMENT_MADE`/`EXPENSE_RECORDED`/`MONEY_TRANSFERRED`/`MOMO_TRANSACTION_MATCHED` (Phase 2 — Cash Box, mobile-money reconciliation), `DEBT_WRITTEN_OFF`/`REMINDER_SENT` (Phase 2 — Debt Book), `PO_*`/`GOODS_RECEIVED`/`SUPPLIER_INVOICE_RECORDED` (Phase 3 — Suppliers).

### 0.2 Credit sales without the Debt Book
D.4's basket footer requires a customer picker, balance display, and credit-limit-blocked "On credit" payment tile — but the full Debt Book room (statements, ageing, reminders, write-offs, broadcast — D.6) is Phase 2. Phase 1 builds: a `customers` table, a `customer_balance` projection driven by `SALE_RECORDED`/`RETURN_RECORDED`, credit-limit enforcement at the point of sale, and a minimal customer picker/quick-add inline at the Counter. No standalone Debt Book screen yet — that's Phase 2's job to build *on* this data.

### 0.3 Payment methods are all manual this phase
D.4's payment tiles (Cash · MoMo · Airtel · Bank · Card · Cheque · Credit) are all built, but MoMo/Airtel are **manual entry** (transaction ID field) — the "Request payment" push-API integration is explicitly Phase 2 ("mobile-money API integration and reconciliation"). The manual-fallback field the spec calls "always visible... never a dependency" is therefore the *only* path this phase, which is a strict subset of the spec'd UI, not a deviation from it.

### 0.4 Receipts: real PDF/print, stubbed WhatsApp/SMS send
Receipt generation (PDF, printable HTML) and the receipt data model are real this phase. `Send on WhatsApp`/`Send by SMS` follow the same pattern as Phase 0's OTP stub: a `NotificationSender` interface with a real console/log-backed implementation for local dev and a documented seam for the real WhatsApp Business API integration in Phase 5 (D.12). `Print` and `No receipt` work for real; a receipt is always viewable/downloadable as PDF regardless of send channel.

### 0.5 Stock-take and transfers are in scope, barcode hardware is not
D.5.4 (stock-take) and D.5.5 (transfers) are part of "products and stock" and are built this phase. The barcode-scanner HID-timing detection (D.4) is implemented in the product search input, but — as with Phase 0's TOTP — I have no physical scanner to test against in this sandbox; it's verified by simulating fast keystroke-then-Enter input in Playwright, not real hardware. Flagging that honestly rather than claiming a hardware-verified result.

### 0.6 Onboarding's CSV importer
D.2 Step 3's "Upload a list" gets a real CSV importer (column mapping, per-row validation, duplicate detection, corrected-template re-download). XLSX parsing is included via a well-audited pure-JS parser (`exceljs` or equivalent — picked at implementation time, no server-side macro execution, size-capped). "Connect now" for mobile money (Step 2) degrades to "Connect later" for everyone this phase, per the spec's own graceful-degradation rule — there's no real MoMo API integration to connect to yet.

---

## 1. Data model additions

New tables (all tenant-scoped, RLS `ENABLE`+`FORCE`, `business_id` FK):

- `categories`, `units` (with conversion factors), `products`, `product_aliases`, `product_locations` (on-hand qty per product per location — the `product_stock` projection's backing table)
- `customers` (name, phone, credit_limit_minor, terms_days) — `customer_balance` projection backing table
- `day_sessions` (per location, per business-day: opened/closed timestamps, counted/expected/variance, reason)
- `till_sessions` (per cashier, within a day session: opening float, closing count, variance)
- `sales`, `sale_lines`, `sale_payments`, `receipts` (sequence per business)
- `quotes`, `quote_lines`
- `returns`, `return_lines`
- `stock_movements` (the D.5.3 read-only ledger — one row per unit-affecting event, append-only, feeds the stock card)
- `stocktakes`, `stocktake_lines`
- `stock_transfers`, `stock_transfer_lines`

**Migrations:** one Alembic migration per logical group (products/units/categories → customers → day/till → sales/quotes/returns → stock movements/stocktakes/transfers), each with a real down-migration, matching the Phase 0 convention.

---

## 2. Projections

Extend `projections/framework.py` with handlers for each Phase-1 event type (§0.1 list), each updating its backing table **in the same transaction** as the event append, per the Phase 0 projection framework:

- `product_stock` ← `STOCK_RECEIVED`, `STOCK_ISSUED`, `STOCK_ADJUSTED`, `STOCK_TRANSFERRED_OUT/IN`, `STOCK_WRITTEN_OFF`, `STOCKTAKE_POSTED`, `SALE_RECORDED` (line-level stock-out), `RETURN_RECORDED` (restock branch only)
- `customer_balance` ← `SALE_RECORDED` (credit lines), `RETURN_RECORDED`, `CREDIT_LIMIT_CHANGED`
- `money_location_balance` (already scaffolded in Phase 0) ← `SALE_RECORDED` payments, `DAY_OPENED`/`DAY_CLOSED` counted amounts
- `daily_totals`, `staff_daily_totals`, `product_daily_movement` ← `SALE_RECORDED`, `RETURN_RECORDED` (these back the Overview's "Today" and "Top and bottom" sections)
- `stock_movements` ledger row ← every stock-affecting event, written alongside the projection update, never edited after

Nightly projection-audit job (Phase 0 machinery) extended to recompute and diff all of the above, not just `money_location_balance`.

**Tests:** each new projection has an in-transaction update test and a rollback-on-failure test (Phase 0 pattern); the audit job's drift detection is exercised with a deliberately injected mismatch, same as Phase 0.

---

## 3. API endpoints (FastAPI routers)

- `products` — CRUD, alias management, category/unit CRUD, CSV/XLSX import (validate → preview → commit), bulk price/category actions, low-stock/out-of-stock/negative-stock/expiring/dead-stock/below-cost filters (D.5.1's quick-filter chips)
- `stock` — stock card (per product), stock movements ledger (filterable), manual receive, adjust, stocktake lifecycle (start/count/review/post), transfers (create/receive)
- `customers` — CRUD, quick-add, balance lookup
- `sales` — basket-to-sale (atomic: writes `SALE_RECORDED` + line/payment/customer-balance/stock side effects in one transaction), park/resume, quotes (create/convert/expire), returns
- `day` — open, close, status; `till` — open session, close session
- `receipts` — fetch/render a receipt by number, PDF download
- `overview` — the D.10.1 read model (today/needs-you-today/money-position/this-month/top-bottom), reading only from the projections above

**Idempotency:** every mutating endpoint (`sales`, `stock`, `day`, `till`) requires the `Idempotency-Key` header per the Phase 0 convention — critical here because the Counter must survive a flaky connection without double-selling.

**Cross-tenant isolation suite:** the Phase 0 auto-discovery suite picks up every new route automatically (that was the point of building it that way) — no manual re-registration needed, but I'll still run it explicitly against the full new route set before calling this phase done.

---

## 4. Frontend screens

- **Onboarding (D.2)** — 5-step shelf, server-persisted resumable state, CSV/XLSX importer with mapping UI, grid-entry stock table, staff invite (reuses Phase 0 auth invite plumbing), opening balances (till, bank, who-owes-you, who-we-owe).
- **Open the Shop (D.3)** — non-dismissible-without-choice modal, denomination breakdown, live variance line, reason field above threshold.
- **Counter (D.4)** — three-column desktop / collapsing tablet / bottom-sheet mobile layout; product search with fuzzy match + barcode-timing detection + SKU exact-match; basket with stepper/price-override/discount/unit-conversion; take-payment drawer with multi-line payments and the credit-limit block; receipt options; returns and quotes sub-flows; park-sale tabs.
- **Stock Room (D.5)** — dense product table with the quick-filter chips, product detail drawer (Details/Pricing/Stock/Movement tabs — Suppliers tab deferred to Phase 3), stock movements ledger, stock-take workflow (start → count → review → post), transfers.
- **Till sessions (D.7.5)** — open/close UI reused from the D.3/D.11 denomination-count pattern, scoped per cashier.
- **Close the Shop (D.11)** — stepped full-screen flow: open-business check, count the till, day summary card, close, dispatch (stubbed per §0.4).
- **Overview (D.10.1)** — single scannable column, phone-first.

All built against the existing `/design` component library (Money, Qty, Table, Drawer, ConfirmDialog, etc.) — no new ad-hoc UI primitives unless a genuine gap shows up, in which case it's added to `/design` first.

**Tests:** Vitest for new components (basket math, denomination breakdown sum, credit-limit gate), Playwright e2e for the full sell-a-product-for-cash flow, a credit sale hitting the limit block, day open→sell→day close round trip, and an axe pass on Counter/Stock Room/Overview at the three standard viewports.

---

## 5. Definition of done for Phase 1

- [ ] A cashier can sign in, open the day, sell a real product for cash with correct change, and the stock count and till balance are correct afterward
- [ ] A credit sale against a customer blocks correctly at the credit limit and requires a manager PIN override
- [ ] Stock-take start → count → review → post produces correct correction movements and a shrinkage figure
- [ ] Transfers leave stock in an `In transit` state until the destination confirms receipt
- [ ] Day close reconciles till variance and produces a day summary; Counter is read-only after close
- [ ] Overview shows real, correct figures sourced from the same projections as the rest of the app
- [ ] Cross-tenant isolation suite passes against every new route; idempotency verified on `sales`/`day`/`till`
- [ ] `docs/RUNBOOK.md`/`docs/DECISIONS.md` updated; accessibility floor met; strings externalised

## 6. Execution approach

Same split as Phase 0: backend (data model, projections, endpoints, tests) as a background agent in an isolated worktree; frontend (screens, against the backend's OpenAPI contract) done directly by me; merged and independently re-verified the same way Phase 0 was — I re-run the backend's test suite myself before merging, not just trust its report. Small conventional commits per section (products/stock → sales/day/till → onboarding UI → counter UI → stock room UI → overview UI), pushed to `rebuild/phase-1` off `rebuild/phase-0`.

---

Proceeding now — starting the backend agent on §1–3 and beginning Onboarding/Counter scaffolding myself.
