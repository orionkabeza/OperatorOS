# OperatorOS — Complete Product & Design Specification

**Version:** 1.0
**Segment:** Established mid-level businesses — retail shops, hardware stores, wholesalers, pharmacies, agro-dealers, auto-parts dealers, building-supply yards. Typically 3–50 staff, 1–5 locations, already trading profitably, currently running on some mix of paper ledgers, Excel, a basic POS, WhatsApp, and memory.
**Not the segment:** street vendors and single-person informal traders (different price sensitivity, different feature set), and enterprise/multinational retail (different procurement cycle).

---

## PART A — What this product is

### A.1 The one-sentence definition

> OperatorOS is the record of everything that happens in your business, and the place you go to see it.

Not "AI for business." Not "WhatsApp automation." Those are features. The product is a **system of record** — the ledger — plus the fastest possible ways to write to it and read from it.

### A.2 The three promises

Every feature must serve one of these. If it serves none, it does not ship.

| Promise | What the owner says | What it means technically |
|---|---|---|
| **Nothing is lost** | "Everything that happened is written down." | Append-only event ledger; no silent deletes; full audit trail. |
| **Nothing is a guess** | "I know my real margin, my real stock, my real debt." | Derived views computed from the ledger only — never hand-typed summary figures. |
| **Nothing is manual twice** | "I record it once and it flows everywhere." | One event updates stock, cash, customer balance, staff attribution, and tax record simultaneously. |

### A.3 The competitive framing

The buyer is currently choosing between: a generic POS (records sales, knows nothing about credit or suppliers), QuickBooks/Sage (accountant's tool, owner never opens it), Excel (accurate until it isn't), and paper. OperatorOS wins by being the only one that is **simultaneously the till, the debt book, the stock card, and the report** — and by being reachable over WhatsApp when the owner isn't in the shop.

### A.4 Why "OS" is earned, not branding

An operating system does three things: it owns the resources, it schedules the work, and it gives every application a common interface. OperatorOS does the equivalent:

- **Owns the resources** — stock, cash, receivables, staff time are all tracked as finite, allocated resources.
- **Schedules the work** — the day has an open and a close; reorders, debt chases, stock-takes, and declarations are scheduled jobs that surface as tasks.
- **Common interface** — every module reads and writes the same ledger with the same event grammar.

---

## PART B — Design direction & system

### B.1 The concept: **The Shop Floor**

The brief is "the user should feel like they're walking around their business." So the interface is not a dashboard with a sidebar. It is a **place**, rendered in the visual language of the physical businesses we're selling to: painted steel shelving, enamel signage, price tickets, ruled ledger paper, receipt tape, safety-yellow warning tape, the roll-up shutter.

Deliberately *not*: the dark-mode analytics cockpit, the pastel fintech gradient, the cream-and-serif editorial look. Those signal "software product." We want "your premises."

The day has a **shape**: you raise the shutter, you work the counter, you close the shutter and count the cash. That ritual is both the emotional spine of the design and a genuine accounting control (an open/close cycle with a cash reconciliation is how you catch theft). The metaphor earns its place because it encodes something operationally true.

### B.2 Palette

Named tokens. Every colour in the product comes from this list; nothing is invented at the component level.

| Token | Hex | Role |
|---|---|---|
| `--floor` | `#EDEFE9` | Base background. Cool off-white with a faint green cast — polished concrete / ledger paper under fluorescent light. |
| `--paper` | `#FAFBF7` | Card and surface background, one step lighter than the floor so cards read as objects resting on it. |
| `--steel` | `#2B373D` | Structural chrome: top rail, shutter, nav, table headers. Painted steel shelving blue-grey. |
| `--steel-deep` | `#1B2427` | Shutter closed state, modal scrim, deepest structure. |
| `--ink` | `#12171A` | Primary text. |
| `--ink-soft` | `#5C686E` | Secondary text, labels, meta. |
| `--rule` | `#D3D8CF` | Hairlines, table rules, dividers. |
| `--tape` | `#F2B705` | **Signature accent.** Safety/price-ticket yellow. Primary actions, the tally rail, active nav marker, focus rings. Used with discipline — it is the only saturated warm colour in the product. |
| `--tape-deep` | `#C99204` | Pressed/hover state of accent. |
| `--in` | `#1F6F4A` | Money in, stock in, positive variance, paid. Ledger green. |
| `--out` | `#B3402E` | Money out, debt, negative variance, overdue, shrinkage. Oxide red. |
| `--watch` | `#8A6A17` | Warnings that are not yet failures: low stock, approaching expiry, ageing debt. |

**Rules:**
- Yellow (`--tape`) never signals danger and never signals money. It signals *"this is the action"* and *"you are here."*
- Green and red are reserved exclusively for direction of money/stock movement. Never use green for "success toast" — use `--steel` for neutral confirmation. This keeps green meaning exactly one thing on every screen.
- Dark mode: invert to `--floor: #171D20`, `--paper: #1E262A`, keep `--tape`, desaturate `--in`/`--out` by 12% for contrast on dark. Ship in v2, not v1.

### B.3 Typography

Three faces, three jobs.

| Role | Face | Usage |
|---|---|---|
| **Display / signage** | **Archivo Expanded** (700, 600) | Screen titles, room names, the shutter wordmark, big figures on the tally rail. Wide, flat-sided, enamel-sign quality. Always uppercase for room names, sentence case for headings. Letter-spacing `0.02em` at large sizes, `0.06em` for uppercase labels. |
| **Body / UI** | **Public Sans** (400, 500, 600) | All interface text, form labels, buttons, body copy. Utilitarian, high legibility at small sizes, government-form neutrality that stays out of the way. |
| **Data / money** | **IBM Plex Mono** (400, 500) | Every currency figure, quantity, SKU, receipt number, phone number, date in a table. Tabular numerals mandatory — columns of money must align on the decimal. Receipt-tape association is intentional. |

**Type scale** (rem, 16px base):
`0.6875` (11px, micro-label, uppercase, tracked) · `0.8125` (13px, meta) · `0.875` (14px, table body, dense UI) · `1` (16px, body) · `1.25` (20px, card title) · `1.75` (28px, section head) · `2.5` (40px, screen title) · `3.5` (56px, tally figure) · `4.5` (72px, close-of-day total)

**Money formatting rule (global):** `RWF 1,240,500` — currency prefix in `--ink-soft` at 0.75em, figure in Plex Mono at full size, thousands separated, no decimals for RWF. Negative figures in `--out` with a leading minus, never parentheses. Amounts owed to the business are positive; amounts the business owes are negative.

### B.4 Layout, spacing, geometry

- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 px. Nothing off-scale.
- **Radius:** `2px` on everything. Not zero (too brutalist), not 12px (too consumer-app). 2px reads like a stamped metal edge or a cut price ticket. The only exception: the shutter and the tally rail have `0`.
- **Borders:** `1px solid var(--rule)`. Cards do not use drop shadows for elevation — they use a 1px rule plus a 3px offset "shelf shadow" (`box-shadow: 3px 3px 0 rgba(18,23,26,0.06)`) so they feel like objects sitting on a shelf, not floating glass.
- **Grid:** 12-column, 24px gutter, max content width 1440px, page padding 32px desktop / 16px mobile.
- **Density:** this is a work tool used all day. Default to dense. Table rows 44px, not 64px. Form fields 40px tall. Buttons 40px (primary actions 44px).

### B.5 The signature elements

**1. The Shutter.** The login screen is a closed roll-up shutter in `--steel-deep`, with horizontal slat lines every 14px rendered as CSS gradients, the business name stencilled across it, and a keyhole-shaped sign-in card set into it. On successful auth, the shutter **rolls up** (400ms, `cubic-bezier(.22,.61,.36,1)`, slats compressing toward the top) to reveal the shop floor behind it. Respects `prefers-reduced-motion` — becomes a 150ms fade.

This is not decoration: the same shutter motif reappears as the **Open the Shop / Close the Shop** control, which is the real daily open/close cycle with cash counts.

**2. The Tally Rail.** A 56px fixed strip directly under the top nav, in `--steel`, present on every screen. It shows today's live figures the way a chalkboard above a counter would: `TAKEN TODAY` · `ON CREDIT` · `IN THE TILL` · `LOW STOCK`. Figures in Archivo Expanded, labels in 11px tracked uppercase Public Sans. Numbers tick up with a 300ms count animation when a sale lands. A thin `--tape` underline sits beneath whichever figure the current room relates to. This is the "I can see my business at a glance" promise, made unavoidable.

**3. Room navigation.** Left rail, 220px, `--steel` background. Each room is a stencilled uppercase label with a 2px `--tape` left marker when active. Rooms, in order:

```
┌────────────────────┐
│  ▌ COUNTER         │  ← sell, quote, return
│    STOCK ROOM      │  ← inventory, stock-takes
│    DEBT BOOK       │  ← who owes you
│    CASH BOX        │  ← money in/out, MoMo, bank
│    SUPPLIERS       │  ← purchase orders, what you owe
│    TEAM            │  ← staff, shifts, commission
│    BACK OFFICE     │  ← reports, ask, compliance
├────────────────────┤
│    ⟟ CLOSE THE SHOP│
└────────────────────┘
```

Collapsible to a 64px icon rail. On mobile, becomes a bottom bar with the five most-used rooms and a "More" sheet.

### B.6 Component library

Every component below is specified once here and referenced by screen specs later.

**Button — Primary.** `--tape` fill, `--ink` text, 2px radius, 44px tall, 20px horizontal padding, Public Sans 600 14px. Hover: `--tape-deep`. Active: translate 1px down, shadow removed. Disabled: `--rule` fill, `--ink-soft` text, cursor not-allowed, with a `title` explaining *why* it's disabled. Focus: 2px `--tape` outline with 2px offset, plus a 1px `--ink` inner ring so it's visible on yellow.

**Button — Secondary.** Transparent fill, 1px `--steel` border, `--ink` text. **Button — Danger.** `--out` fill, white text; requires a typed confirmation for destructive actions. **Button — Ghost.** Text only, `--ink-soft`, underline on hover.

**Input.** 40px, `--paper` fill, 1px `--rule` border, 2px radius. Label above in 11px tracked uppercase `--ink-soft`. Focus: border becomes `--steel`, 2px `--tape` ring. Error: border `--out`, message below in 13px `--out` stating what's wrong and how to fix it. Money inputs use Plex Mono, right-aligned, with a `RWF` prefix chip inside the field on the left.

**Table.** Header row `--steel` background, white 11px tracked uppercase text, sticky on scroll. Body rows 44px, alternating `--paper` / transparent, 1px `--rule` bottom border. Numeric columns right-aligned in Plex Mono. Row hover: 2px `--tape` left border appears. Row click opens a detail drawer, never a full page navigation (keeps context). Every table has: column sort, a filter bar, a saved-view selector, "Export CSV", and a live row count.

**Drawer.** Slides from right, 480px (720px for detail-heavy), `--paper`, 1px `--rule` left edge, scrim `--steel-deep` at 40%. Header with title + close. Footer with actions, always pinned.

**Card.** `--paper`, 1px `--rule`, 2px radius, shelf shadow, 24px padding. Title in Archivo Expanded 20px. Optional 11px tracked uppercase eyebrow in `--ink-soft`.

**Toast.** Bottom-left, `--steel` fill, white text, 4s auto-dismiss, with an Undo affordance where the action is reversible. Never green. Text matches the button that caused it: "Save sale" → "Sale saved."

**Empty state.** Never a shrug. A one-line statement of what lives here, and the primary action. E.g. Debt Book empty: *"No one owes you anything right now. When you sell on credit from the Counter, it lands here."* + `Record a credit sale`.

**Confirm dialog.** Used only for irreversible or high-value actions. States the consequence in plain language with the actual numbers: *"This writes off RWF 340,000 owed by Kigali Builders Ltd. It cannot be undone, and it will show in your reports as a loss."* Requires typing the customer name for write-offs above a configurable threshold.

### B.7 Motion

Restrained. Four permitted animations:
1. Shutter raise/lower (400ms) — the one showpiece.
2. Tally rail figure count-up (300ms) when a value changes.
3. Drawer slide (200ms ease-out).
4. Row/toast fade-in (120ms).

Nothing else animates. No page transitions, no skeleton shimmer beyond a static grey block, no parallax. All motion is gated behind `prefers-reduced-motion`.

### B.8 Voice

- Room names and physical nouns: Counter, Stock Room, Debt Book, Till, Shelf, Delivery.
- Never system nouns: no "entity", "record", "sync", "config", "webhook", "instance".
- Buttons say what happens: `Record sale`, `Take payment`, `Order more`, `Write off debt`, `Close the shop`.
- The action keeps its name through the flow. `Take payment` → the drawer is titled "Take payment" → the toast says "Payment taken."
- Errors state what happened and the fix: *"Stock check failed — you have 12 of these, this sale needs 20. Reduce the quantity or record a stock-in first."*
- Kinyarwanda and English throughout; French for the Kigali commercial segment. Language is per-user, not per-business.

---

## PART C — Information architecture

### C.1 The seven rooms and what lives in each

| Room | Owner's job here | Primary objects |
|---|---|---|
| **Counter** | Sell things. Fast. | Sale, Quote, Return, Customer lookup |
| **Stock Room** | Know what I have and what it cost. | Product, Variant, Stock movement, Stock-take, Location |
| **Debt Book** | Get my money back, and stay in front of everyone who buys from me. | Customer account, Credit sale, Payment, Reminder, Write-off, Segment, Broadcast |
| **Cash Box** | Know where the money is. | Till session, MoMo transaction, Bank record, Expense, Transfer |
| **Suppliers** | Buy well and know what I owe. | Supplier, Purchase order, Goods receipt, Supplier invoice, Payment |
| **Team** | Know who did what. | Staff member, Role, Shift, Commission, Activity trail |
| **Back Office** | Understand and comply. | Analytics, Reports, Ask, Tax/EBM, Settings, Business profile |

### C.2 Global chrome (present on every screen)

**Top nav (56px, `--steel`):** Business name + location switcher (left) · Global search (centre, `⌘K`) · Day status pill ("Shop open — 4h 12m") · Notifications bell · User avatar menu (right).

**Location switcher:** for multi-branch businesses. Dropdown listing each location with its live till balance. An "All locations" option that puts every screen into consolidated mode with a location column added to tables. The current location is stored per-session, shown as a chip in the top nav, and **stamped onto every event written while it is active.**

**Global search (`⌘K`):** searches across products (name, SKU, barcode), customers (name, phone), suppliers, sales (receipt number), and purchase orders — in that priority order. Typing a pure number searches receipt numbers and phone numbers first. Results grouped by type with keyboard navigation. Also acts as a command palette: typing "new sale", "stock take", "close shop" jumps to those actions.

**Notifications:** three severities — `--out` (needs action today: overdue debt, negative stock, failed MoMo reconciliation), `--watch` (this week: low stock, expiring goods, PO overdue), neutral (informational: shift closed, report ready). Each notification links to the exact row that caused it.

---

## PART D — Screen-by-screen specification

Every screen below is specified as: purpose · layout · every control · every state · every rule.

---

### D.1 The Shutter (sign-in)

**Purpose:** authenticate, and set the emotional frame — you are unlocking your own premises.

**Layout.** Full viewport, `--steel-deep`. Horizontal slat texture across the whole surface: `repeating-linear-gradient(180deg, rgba(255,255,255,.04) 0 1px, transparent 1px 14px)`. The business name (if the subdomain or last-used tenant is known) is stencilled across the upper third in Archivo Expanded 700, 56px, `rgba(255,255,255,0.14)` — like paint on a shutter. Centred, a 380px `--paper` card set into the shutter with a 4px `--tape` top edge.

**Card contents, top to bottom:**
1. Eyebrow, 11px tracked uppercase `--ink-soft`: `OPERATOROS`
2. Heading, Archivo Expanded 28px: `Open up`
3. Field — **Phone number or email**. Phone input defaults to `+250` with a country selector; accepts local format `07…` and normalises. Autofocus.
4. Field — **PIN or password**. Businesses choose at setup which mode the whole tenant uses. PIN mode renders 6 individual 44px boxes, numeric keypad on mobile, auto-advance, paste-aware. Password mode is a standard field with a show/hide toggle.
5. Checkbox — **Keep this device signed in for 30 days**. Off by default. When ticked, shows a 13px `--ink-soft` note: *"Only tick this on a device you control."*
6. Primary button, full width, 44px: `Raise the shutter`
7. Ghost link: `I forgot my PIN`
8. Below the card, 13px `rgba(255,255,255,0.45)`: `Kinyarwanda · English · Français` as a language switcher.

**States:**
- *Idle* — as above.
- *Submitting* — button label becomes `Raising…`, button disabled, a 2px `--tape` indeterminate bar runs across the card's top edge.
- *Wrong credentials* — card shakes 6px horizontally over 180ms (suppressed under reduced-motion), field border `--out`, message: *"That PIN doesn't match this number. 2 tries left before this device is locked for 15 minutes."* The remaining-attempts count is shown from attempt 3 onward, never earlier (don't teach an attacker the threshold immediately).
- *Locked out* — card replaced with: *"Too many tries. This device is locked until 14:32. If this wasn't you, call your manager."* + `Ask for a reset` which pings the business owner over WhatsApp.
- *Two-factor required* (owner/admin roles, mandatory) — card swaps to a 6-digit code field: *"We sent a code to +250 78• ••• •12."* with `Resend in 30s` countdown, and a `Use my authenticator app instead` link where TOTP is configured.
- *Account suspended / subscription lapsed* — shutter stays down. *"This shop is closed for billing. Your data is safe. The owner can settle from Back Office → Billing."* + `Contact the owner`.
- *First-ever sign-in* — after auth, goes straight to Onboarding (D.2) rather than the shop floor.

**Success:** the shutter raises. Behind it: the Counter, already loaded (prefetched during authentication so there is no blank frame), with a `--tape`-underlined toast: *"Good morning, Eric. The shop has been closed since 8:14pm yesterday."*

**Security notes bound to this screen:** rate limiting per IP and per identifier; device fingerprint recorded; failed attempts logged as events with IP and user agent; no user enumeration (identical message and timing for unknown identifier vs wrong PIN); PIN minimum 6 digits with a blocklist of trivial sequences; session cookie `HttpOnly`, `Secure`, `SameSite=Lax`, 12-hour idle timeout, 30-day absolute maximum with the trust-device option.

---

### D.2 Onboarding — "Fitting out the shop"

**Purpose:** get a real business to a first real sale in under 20 minutes. Framed as fitting out premises, not "configuring your account." Progress shown as a 5-step shelf being filled, not a percentage bar.

**Step 1 — The business.** Legal/trading name, business type (dropdown: Retail shop · Hardware store · Wholesaler · Pharmacy · Agro-dealer · Auto parts · Building supplies · Other), TIN (optional now, required before EBM invoicing), physical address with a map pin, primary phone, currency (defaults RWF, locked after first transaction), financial year start.

**Step 2 — The counter.** Which of these do you take? Toggles: Cash · MTN MoMo · Airtel Money · Bank transfer · Card · Cheque · Credit (sell now, pay later). For each mobile-money option, capture the merchant/paybill code and offer `Connect now` (OAuth/API-key flow) or `Connect later` — connecting later degrades gracefully to manual entry.

**Step 3 — The stock.** Three paths, presented as equal cards:
- `Upload a list` — CSV/XLSX importer with column mapping UI, a preview of the first 20 rows with per-row validation, duplicate detection on SKU and name, and an "import anyway / fix first" choice. Errors are downloadable as a corrected-template CSV.
- `Type them in` — a fast grid entry table (name, SKU, unit, cost, price, opening qty), keyboard-first, `Tab` to next cell, `Enter` for new row.
- `Start with nothing` — products get created on the fly at the Counter the first time they're sold.

**Step 4 — The people.** Add staff by phone number with a role (see F.1). Each gets a WhatsApp invite with a one-time PIN setup link valid 48 hours. Owner can skip and add later.

**Step 5 — The books.** Opening balances: cash in the till, cash in the bank, and — critically — **who already owes you.** A simple table: customer name, phone, amount owed, since when. This is the single highest-value migration step; without it the Debt Book is useless on day one. Also: what you owe suppliers.

**Completion:** a summary card, then `Open the shop` which runs the first day-open (D.3).

**Rules:** every step is skippable except Step 1. The progress shelf persists as a dismissible strip on the Counter until complete. Onboarding state is stored server-side so it resumes on any device.

---

### D.3 Open the Shop (day open)

**Purpose:** establish the day's starting cash position so the close can be reconciled. This is an accounting control disguised as a ritual.

**Trigger:** first sign-in of the day by any user with `open_day` permission, or manually from the day-status pill.

**Modal (560px, cannot be dismissed without a choice):**
- Heading: `Open the shop — Tuesday 19 August`
- Line: `Closed yesterday at 8:14pm with RWF 340,500 in the till.`
- Field: **Count the till now.** Money input, autofocus. Below it, an optional denomination breakdown expander — a table of RWF 5000/2000/1000/500/100/50 notes and coins with quantity inputs that auto-sum. Businesses that use it get a much stronger audit trail.
- Live variance line: as soon as a figure is entered, shows `Matches yesterday's close` in `--in`, or `Short by RWF 12,000` / `Over by RWF 3,000` in `--out`/`--watch`.
- If variance ≠ 0: a required **reason** field appears (dropdown: Miscount at close · Cash taken overnight · Float added · Theft suspected · Other + free text). Variance above a configurable threshold notifies the owner over WhatsApp immediately.
- Buttons: `Open the shop` (primary) · `Not yet` (ghost, closes modal but the day-status pill stays red and the Counter is read-only until the day is opened).

**On confirm:** writes a `DAY_OPENED` event with counted amount, variance, reason, user, location, timestamp, device. Shutter-raise micro-animation on the day-status pill. Tally rail resets to zero for the new day.

---

### D.4 Counter — the selling screen

**Purpose:** record a sale in under 15 seconds, including credit sales, mixed payments, and discounts, without the seller ever leaving the keyboard.

**Layout — three columns on desktop (≥1280px):**

```
┌─────────────┬───────────────────────────┬──────────────────┐
│  CATEGORIES │   PRODUCT SEARCH + GRID   │   THE BASKET     │
│  (180px)    │        (fluid)            │     (420px)      │
│             │                           │                  │
│  All        │  [ search / scan barcode ] │  Customer ▾      │
│  Cement     │  ┌────┐┌────┐┌────┐┌────┐ │  ──────────────  │
│  Steel      │  │    ││    ││    ││    │ │  3× Cement 50kg  │
│  Paint      │  └────┘└────┘└────┘└────┘ │      RWF 42,000  │
│  Tools      │  ┌────┐┌────┐┌────┐┌────┐ │  1× Trowel       │
│  Plumbing   │  │    ││    ││    ││    │ │       RWF 4,500  │
│  Electrical │  └────┘└────┘└────┘└────┘ │  ──────────────  │
│             │                           │  Subtotal 46,500 │
│  + Add      │                           │  Discount     0  │
│             │                           │  VAT 18%   8,370 │
│             │                           │  TOTAL    54,870 │
│             │                           │  [ TAKE PAYMENT ]│
└─────────────┴───────────────────────────┴──────────────────┘
```

On tablet (768–1279px) categories collapse to a horizontal scroll strip. On mobile, the basket becomes a bottom sheet that expands from a persistent bar showing item count and total.

**Product search field.** Autofocus on screen load and after every completed sale. Behaviour:
- Types → fuzzy search across name, SKU, barcode, and a per-product "also known as" alias list (critical: hardware stores call the same item three different things).
- A barcode scanner (USB HID) types fast and ends with Enter — detected by inter-keystroke timing and treated as an exact barcode lookup that adds directly to the basket.
- Numeric-only input matching a SKU adds directly.
- `Enter` on the top result adds it. `Shift+Enter` adds it and opens the quantity field.
- No match → inline row: `No product called "elbow 40mm". [Create it] [Sell as a one-off item]`.

**Product tile.** 140×120px. Name (2 lines max, Public Sans 600 14px), selling price in Plex Mono, and a stock chip bottom-right: green `24 in stock`, `--watch` `4 left`, `--out` `Out of stock`. Out-of-stock tiles are 50% opacity and, when clicked, offer `Sell anyway (creates negative stock)` — permission-gated and always logged — or `Order from supplier`.

**Basket row.** Product name · a quantity stepper (− / editable number / +) · unit price (click to edit if the user has `override_price`) · line total · a `×` remove. Long-press or right-click opens: Change price · Apply line discount · Add note · Change unit (piece/box/bundle, with automatic conversion using the product's unit factors) · Remove.

**Basket footer.**
- **Customer** selector: search by name or phone, shows the customer's outstanding balance inline next to their name in `--out`. `Walk-in` is the default. Creating a new customer inline requires only name + phone.
- **Discount** control: toggles between a percentage and an amount. Discounts above a configurable percentage require a manager PIN entered inline — that PIN entry is recorded against the sale.
- **VAT**: computed per product's tax class. A line shows the VAT total; the whole block is hidden for non-VAT-registered businesses.
- **TOTAL**: Archivo Expanded 40px, right-aligned, Plex Mono numerals.
- Primary button: `Take payment` (44px, full width). Disabled with a tooltip when the basket is empty or the day isn't open.
- Secondary row: `Save as quote` · `Park sale` (holds the basket, lets the seller start another — parked sales appear as tabs above the basket) · `Clear`.

**Take payment drawer (720px).** The most important drawer in the product.
- Header: `Take payment — RWF 54,870`
- **Payment method tiles** (large, 4 across): Cash · MoMo · Airtel · Bank · Card · **On credit**. Each tile, when selected, adds a payment line. **Multiple lines are allowed** — this is how real shops work (RWF 30,000 cash + 24,870 on MoMo).
- Each payment line: method, amount (defaults to the remaining balance), and method-specific fields:
  - *Cash* → `Cash given` field, and a **change due** figure appears in Archivo Expanded 32px. This alone sells the product to a hardware store.
  - *MoMo/Airtel* → customer phone (pre-filled from the customer record), and a `Request payment` button that pushes a payment prompt to the customer's phone via the mobile-money API. Line shows a live status: `Waiting for customer…` → `Paid` (green) / `Declined` / `Timed out — enter the transaction ID manually`. Manual fallback field for the transaction ID is always visible; the API is a convenience, never a dependency.
  - *Bank/Cheque* → reference number, and for cheques a due date that creates a follow-up task.
  - *On credit* → shows the customer's current balance, their credit limit, and the resulting new balance. **Blocked** if it would exceed the limit, with an override that requires a manager PIN and a reason. Due date field defaults to the customer's agreed terms (e.g. +30 days).
- **Running remainder**: `RWF 0 remaining` in `--in` when fully covered; the confirm button stays disabled until remainder ≤ 0.
- Confirm button: `Complete sale`.

**On completion:** one atomic transaction writes `SALE_RECORDED` plus its child events (stock out per line, cash/MoMo in per payment, customer balance change if credit, staff attribution, tax record). Then:
- Receipt options appear: `Print` · `Send on WhatsApp` · `Send by SMS` · `No receipt`. Default is remembered per business. WhatsApp receipt sends a formatted message plus a PDF.
- Tally rail figures tick up.
- Basket clears, focus returns to the product search.
- Toast: `Sale saved — receipt #00184` with `Undo` for 20 seconds (which writes a reversing event, never deletes).

**Returns & refunds.** From `Counter → Returns`, or by searching a receipt number in global search. Flow: find the sale → tick the lines being returned and their quantities → choose restock or write off as damaged (damaged goods write a `STOCK_WRITTEN_OFF` event, not a stock-in) → choose refund method (cash out / MoMo out / credit note to the customer's account) → reason (required, dropdown + notes) → `Complete return`. Every return is permission-gated and appears in the Team activity trail. Returns beyond a configurable window require manager approval.

**Quotes.** Same basket, saved with an expiry date and a quote number. Quote list with statuses: Open · Accepted · Expired · Converted. `Convert to sale` reopens the basket with current prices and flags any price that has changed since the quote was issued.

---

### D.5 Stock Room

**Purpose:** the truth about what you have, what it cost, and what's about to become a problem.

**D.5.1 Product list (default view).** Dense table. Columns: Photo (32px thumb) · Name · SKU · Category · **On hand** · **Available** (on hand minus reserved by open orders) · Unit cost · Selling price · **Margin %** (computed, colour-coded: `--in` above target, `--watch` within 5pts, `--out` below cost) · Value on hand (qty × cost) · Location(s) · Status.

Filter bar: category, supplier, location, and quick-filter chips: `All` · `Low stock` · `Out of stock` · `Negative stock` · `Expiring in 30 days` · `No movement in 90 days` · `Below cost`. The last two are the ones that make owners money and nobody else surfaces them.

Bulk actions on selected rows: Adjust price (by % or amount) · Change category · Change supplier · Print labels · Export · Archive.

**D.5.2 Product detail drawer (720px), tabbed:**
- **Details** — name, aliases (the "also known as" list), SKU, barcode, category, brand, supplier(s) with each one's cost and lead time, unit of measure with conversion factors (e.g. 1 box = 12 pieces = 1 piece × 12), tax class, image, notes.
- **Pricing** — cost price (with method: last cost / weighted average / FIFO, set per business), selling price, optional wholesale and "special customer" price tiers, minimum selling price (the Counter refuses to go below it without a manager PIN), and a **price history chart** showing cost and selling price over time. Margin displayed prominently.
- **Stock** — on hand per location, reorder point, reorder quantity, and the **stock card**: a reverse-chronological ledger of every movement (date, type, qty in/out, running balance, reference, user). This is the auditable heart of inventory. Every row links to its source document.
- **Movement** — sell-through chart (units/week over 12 weeks), days-of-cover figure (`At current sales, this lasts 11 days`), and a seasonality note where enough history exists.
- **Suppliers** — who sells it, at what cost, lead time, last purchase date and price.

**D.5.3 Stock movements (the "why did my count change" screen).** A single filterable ledger of every movement across all products: type (Sale · Purchase receipt · Return · Adjustment · Transfer · Write-off · Stock-take correction), product, qty, from/to location, user, reference, timestamp. Read-only. Exportable. This is the screen you open when the numbers look wrong.

**D.5.4 Stock-take.** A first-class workflow, not a form.
1. `Start a stock-take` → scope selector: whole shop · one category · one location · a saved list · "items not counted in 90 days."
2. Optionally **freeze** the counted items (blocks sales of those items during the count) or allow live counting with movement reconciliation.
3. **Counting screen** — optimised for a phone in one hand. A list of items with a large numeric input each; scan a barcode to jump straight to that item; `Counted` items grey out and move to the bottom; a progress figure `84 of 210 counted`. Multiple staff can count different sections of the same take simultaneously — each entry is stamped with who counted it.
4. **Review screen** — only variances are shown by default. Columns: expected · counted · **variance qty** · **variance value**. Sorted by variance value descending, so the expensive discrepancies are top. A total: `Shrinkage: RWF 214,000 across 17 items`. Each variance row requires a reason before posting if it exceeds a threshold.
5. `Post stock-take` → writes correction events, and a summary is filed in Back Office. **Nothing is silently overwritten** — the corrections are movements, so the stock card explains itself forever.

**D.5.5 Transfers between locations.** Create transfer → pick items and quantities → send. Stock leaves the origin immediately into an `In transit` bucket, and arrives only when the destination confirms receipt (with the ability to receive a different quantity, which raises a discrepancy for investigation). This prevents the classic multi-branch fiction where stock exists in two places at once.

**D.5.6 Alerts generated here.** Low stock (below reorder point) · Out of stock on a fast mover · Negative stock (always urgent — it means something wasn't recorded) · Expiring in N days · Selling below cost · Dead stock (no movement in N days, with the capital tied up quantified in RWF).


---

### D.6 Debt Book

**Purpose:** turn the paper credit notebook into an asset that chases itself. For hardware stores and wholesalers selling to contractors on 30-day terms, this is the screen that justifies the subscription.

**D.6.1 Header band.** Four figures in Archivo Expanded across the top of the room:
`OWED TO YOU  RWF 4,120,000` · `OVERDUE  RWF 1,340,000` · `DUE THIS WEEK  RWF 620,000` · `COLLECTED THIS MONTH  RWF 2,880,000`
Under them, an **ageing bar** — a single horizontal stacked bar segmented Current / 1–30 / 31–60 / 61–90 / 90+ days, coloured from `--in` through `--watch` to `--out`, each segment labelled with its amount and clickable to filter the table below.

**D.6.2 Customer accounts table.** Columns: Customer · Phone · **Balance** · Oldest unpaid (days) · Credit limit · **Limit used** (a small bar, turns `--out` at 100%) · Last payment · Last contacted · Status chip (Current · Due soon · Overdue · On hold · Written off).

Row actions: `Take payment` · `Send reminder` · `Statement` · `Put on hold` · `Adjust limit`.

**D.6.3 Customer account drawer.**
- **Header:** name, phone (click to call / WhatsApp), business name, balance in Archivo Expanded 40px in `--out`, credit limit and terms.
- **Statement tab:** a running account — every credit sale and every payment in date order with a running balance, exactly like the paper book. `Download PDF` and `Send on WhatsApp` produce a formatted statement.
- **Invoices tab:** each open invoice with its due date, amount, amount paid, and remaining. Partial payments allocate to the oldest invoice by default, with a manual allocation option.
- **Contact history tab:** every reminder sent, when, on which channel, and whether it was delivered/read. Plus a `Log a call` action to record a phone conversation and a promise-to-pay date — which then creates a follow-up task.
- **Settings tab:** credit limit, payment terms (days), reminder schedule override, "always require cash" hold, and internal notes.

**D.6.4 Take payment (from the Debt Book).** Drawer: amount (defaults to the full balance), method (Cash / MoMo / Airtel / Bank / Cheque), reference, allocation (auto-oldest-first or manual per invoice), date received (allows back-dating with a reason, permission-gated). Confirm writes a `PAYMENT_RECEIVED` event, updates the customer balance and the till/bank, and offers to send a receipt on WhatsApp.

**D.6.5 Automated reminders — the engine.** Configured once in Back Office, runs quietly forever.
- **Schedule builder:** a sequence of steps relative to the due date. Default: `−3 days: friendly nudge` · `Due date: it's due today` · `+7 days: firm` · `+21 days: final notice` · `+30 days: flag for the owner`.
- **Channels:** WhatsApp (primary), SMS fallback if WhatsApp undelivered after 2 hours, email if on file.
- **Templates:** editable per step, per language, with merge fields (`{customer}`, `{amount}`, `{days_overdue}`, `{oldest_invoice_date}`, `{pay_link}`). A live preview renders with real data from the selected customer.
- **Pay link:** every reminder includes a link that opens a minimal, branded payment page — amount pre-filled, MoMo/Airtel/bank options, and on payment writes straight into the ledger. This closes the loop: the reminder collects the money without anyone at the shop touching it.
- **Guardrails:** quiet hours (no messages 8pm–7am), a maximum of one message per customer per 48 hours across all sequences, a global `Pause all reminders` switch, per-customer opt-out, and an automatic pause when a customer has an open dispute flag.
- **Approval mode:** businesses can require the owner to approve each batch of reminders before sending. A daily digest lists the queued messages with tick boxes and `Send 14 reminders`.

**D.6.6 Write-offs.** Permission-gated, requires a reason and (above a threshold) typing the customer name. Writes a `DEBT_WRITTEN_OFF` event that appears as a loss in reports. Written-off customers stay visible with a `Written off` chip — because they walk back in eventually, and the seller needs to know.

**D.6.7 The "who should I chase today" list.** A prioritised daily list scoring each account by amount × days overdue × payment reliability history. Presented as a work queue with `Call` / `Send reminder` / `Snooze to date` on each row. This is the feature a collections-minded owner opens every morning.

**D.6.8 All customers & broadcast.** Not every customer owes money, and the owner still wants to reach them — this is a deliberate widening of the room beyond debt. A tab alongside the debtor list: **All customers**, every buyer regardless of balance, with total spend, order/visit count, last purchase date, and preferred language. From here:
- **Segments** — saved, auto-updating filters: `Bought in the last 30 days` · `Haven't been back in 60 days` · `Top 20 by spend` · `Bought <product/category>` (critical for a hardware store: "everyone who bought a generator last year" is exactly who to tell when generator parts arrive) · custom filter builder on any customer field. Each segment shows its live member count.
- **Broadcast** — compose a WhatsApp message (text, optionally with an image and a link), pick a segment, preview the recipient count, and send. Rate-limited per WhatsApp Business API rules, queued through the job system, with delivered/read counts reported back per send. Every send is logged with its segment snapshot, so "who did we message and when" is always answerable.
- Same permission and quiet-hours guardrails as the Debt Book reminder engine (D.6.5) — this is the same messaging infrastructure aimed at growth instead of collections, not a separate system.

---

### D.7 Cash Box

**Purpose:** answer "where is my money?" across till, mobile money, and bank, and prove that recorded money equals actual money.

**D.7.1 Balances band.** Cards for each money location: `TILL — RWF 340,500` · `MTN MOMO — RWF 1,204,000` · `AIRTEL — RWF 88,000` · `BANK (BK ••4192) — RWF 6,340,000`. Each shows today's movement (+/−) beneath. Cards for connected accounts show a `Synced 4 min ago` stamp; unconnected ones show `Manual` and an `Update balance` action.

**D.7.2 Money movements table.** Every in and out across every location: date/time · type (Sale · Debt payment · Purchase payment · Expense · Transfer · Owner draw · Capital in · Adjustment) · description · location (till/MoMo/bank) · in · out · balance · user · reference · reconciled ✓. Filterable by date range, type, location, user.

**D.7.3 Mobile money reconciliation — the flagship.** A dedicated tab with two columns:
- **Left: transactions from the MoMo/Airtel API** — every incoming and outgoing transaction with amount, phone, timestamp, transaction ID.
- **Right: what OperatorOS expected** — recorded sales and payments awaiting matching.
- Between them, an auto-match engine pairing on amount + phone + time window, showing a confidence indicator. **Matched** pairs collapse into a single green row. **Unmatched incoming money** is highlighted in `--watch` with actions: `Match to an invoice` · `Record as a debt payment` · `Record as other income` · `Not ours`. **Unmatched expected payments** are highlighted in `--out`: `Chase the customer` · `Mark as cash instead` · `Void`.
- A headline figure: `RWF 84,000 unmatched across 6 transactions` — the number an owner wants at zero.
- Every match writes an event; nothing is edited in place.

**D.7.4 Expenses.** Quick-record: amount, category (Rent · Transport · Utilities · Wages · Repairs · Airtime · Licences · Other, editable), paid from (till/MoMo/bank), payee, date, note, and a receipt photo upload (stored, OCR'd for amount and date to pre-fill the form). Recurring expenses can be scheduled and auto-created as tasks. Expense approval workflow: above a threshold, a manager must approve before it posts.

**D.7.5 Till sessions.** Each cashier opens and closes a till session within the shop's day. Open = declared float; close = counted cash with denomination breakdown, compared against expected (opening float + cash sales − cash refunds − cash payouts). Variance is recorded per session and per cashier, and a **cashier variance report** in Team shows who is consistently short. Handovers between shifts are a close + open pair.

**D.7.6 Bank reconciliation (v2).** Import a bank statement CSV or connect via an aggregator; match against recorded movements with the same two-column engine as D.7.3.

---

### D.8 Suppliers

**Purpose:** buy at the right time and the right price, and know exactly what you owe.

**D.8.1 Supplier list.** Name · contact · phone · **balance owed** · payment terms · lead time (days) · on-time delivery % · items supplied · last order. Sortable by amount owed and by on-time performance.

**D.8.2 Supplier drawer.** Details · items supplied with each one's cost and cost history · purchase orders · invoices and payments statement · performance (on-time %, average lead time, price change history) · notes.

**D.8.3 Purchase orders.**
- **Create PO:** supplier → items (with a `Suggest from low stock` button that pre-fills every item below its reorder point for that supplier, at the reorder quantity, with the projected cost total) → expected delivery date → notes → `Send to supplier` (WhatsApp/email with a PDF) or `Save as draft`.
- **PO statuses:** Draft · Sent · Confirmed · Partially received · Received · Cancelled. Stock is marked `On order` from Sent onwards, which feeds the Available quantity at the Counter.
- **Receive goods:** open the PO → a receiving screen listing ordered vs received quantities → enter what actually arrived (defaults to ordered, but under-delivery and over-delivery are both first-class) → record the **actual unit cost from the invoice**, which may differ from the PO price and updates the product's cost → mark damaged items separately → confirm. Writes stock-in events and creates/links a supplier invoice.
- **Discrepancy flag:** any difference between ordered, received, and invoiced quantity or price raises a discrepancy for follow-up with the supplier, surfaced in the notifications.

**D.8.4 Supplier invoices & payments.** Invoice list with due dates and an ageing view mirroring the Debt Book (but pointing outward). `Pay supplier` records the payment from a chosen money location, allocates it to invoices, and writes the events. A `Due this week` figure sits in the room header so payables never surprise the owner.

**D.8.5 Reorder suggestions.** A standing list computed from reorder point, current stock, on-order quantity, sell-through rate, and supplier lead time: *"Order 40 bags of cement — you sell 12/week, you have 18, lead time is 6 days."* One click turns the whole list into draft POs grouped by supplier.

---

### D.9 Team

**Purpose:** know who did what, pay people correctly, and catch problems early — without turning the app into surveillance theatre.

**D.9.1 Staff list.** Name · role · phone · status (Active · Invited · Suspended) · location · today's sales · this month's sales · last active.

**D.9.2 Staff drawer.** Profile · role & permissions · assigned locations · **performance** (sales value, transaction count, average basket, discount rate given, return rate, till variance history) · **shifts** · **commission** · **activity trail**.

**D.9.3 Shifts.** Clock in/out (from the app, with optional location check), scheduled vs actual hours, a weekly roster grid the manager can drag to build, and an hours summary for payroll export. Late/absent flags.

**D.9.4 Commission.** Rules engine: percentage of sale value, percentage of margin, fixed amount per unit, or tiered by monthly total — scoped to all products, a category, or specific products. A commission statement per staff member per period, with the underlying sales listed, and an `Approve and export` action for payroll.

**D.9.5 Activity trail.** Every meaningful action by every user: sale, discount above threshold, price override, return, stock adjustment, write-off, permission change, export, login. Filterable by user, action type, date. Immutable. This is the record you open when stock goes missing.

**D.9.6 Exception report.** A quiet, factual list rather than an accusation: staff whose discount rate, return rate, void rate, or till variance deviates materially from the team median, with the supporting transactions one click away.

---

### D.10 Back Office

**Purpose:** understand the business, satisfy the taxman, and configure everything.

**D.10.1 The Overview (the screen the owner opens on their phone).**
Not a wall of charts. A single scannable column, in this order:
1. **Today** — taken, on credit, expenses, net, versus the same weekday average, with an arrow.
2. **Needs you today** — a short list of urgent items with counts: `6 customers overdue (RWF 1.34M)` · `4 products out of stock` · `2 MoMo payments unmatched` · `1 PO overdue`. Each links straight to the filtered view.
3. **Money position** — till + MoMo + bank, owed to you, owed by you, and the resulting **working capital** figure.
4. **This month** — revenue, gross profit, expenses, net profit, with last month beside it and a small sparkline.
5. **Top and bottom** — 5 best-selling and 5 best-margin products; 5 dead items with capital tied up.

**D.10.2 Analytics — the business-health dashboard.** This is the room's second tab, next to Overview: charts and comparisons where Overview is a scannable list. Purpose: let an owner or manager see *how the business is doing* — trend, direction, comparison — not just what's in it. This is the direct answer to "compare timelines and products, what's doing good and what's not."

*Time control (sticky at the top of the room, governs every chart below it):*
- **Range** — 7D · 30D · 3M · 12M · This year · Custom.
- **Compare to** — vs previous period (default) · vs same period last year · vs a chosen period · Off.
- **Location** — All locations · a specific branch.
Changing any of these re-renders the whole room in place, with flat grey loading blocks (no shimmer, per the motion rules). The chosen range persists per user until changed.

1. **KPI band.** Cards in Archivo Expanded numerals, each with a **delta chip** vs the comparison period: Revenue · Gross profit (with margin % beneath) · Net profit · Cash position (till + MoMo + bank) · Owed to you · Owed by you · **Working capital** (owed to you − owed by you — the one figure that answers "am I actually healthy").
   **Delta colour rule** (naive up=green is wrong for half these): Revenue, gross profit, net profit, cash position, working capital — up is `--in`, down is `--out`. Owed by you (payables) — up is `--out` (owing more is worse). Owed to you (receivables) is directionally ambiguous on its own (more can mean more sales or slower collection), so its chip stays neutral `--ink-soft` and is paired with the real signal beneath it: `of which 90+ days: RWF 210,000` in `--out` when non-zero.
2. **The trend chart.** One large chart, series switchable via segmented control: **Revenue · Gross profit · Net profit · Cash flow**. Line chart, X-axis at the range's natural granularity, Y-axis in compact RWF notation (`1.2M`, `840K`) with exact figures on hover. The comparison period renders as a second, dashed, lower-contrast line so the shape of "this vs last" reads at a glance. A hover marker shows both values and the delta for that point. Below the chart, a one-line auto-generated caption states the headline in words — *"Revenue is up 12% versus last month, driven mostly by the second half of the month."*
3. **Product & category performance.** One ranked table, toggle **By product / By category**, sortable on any column: Name · Units sold · Revenue · Gross margin % · delta vs comparison period · a 12-point sparkline. Default sort revenue descending. Filter chips: `All` · `Rising` · `Falling` · `New this period` · `Dead stock`. Row click opens a **product drill-down drawer**: that product's own trend chart, margin history, stock position, top customers.
4. **Owed to you vs owed by you.** A compact two-bar comparison — not a duplicate of the Debt Book/Suppliers rooms, just their ageing data surfaced for context — each bar segmented by age bucket in the D.6.1 colour ramp, with working capital sitting between them. Click either bar to jump to the full room.
5. **Cash flow.** A stacked bar chart, one bar per period: money-in segments (Sales, Debt collected, Other income — `--in` shades) stacked above the axis, money-out segments (Expenses, Supplier payments, Owner draws — `--out` shades) below it, net line overlaid. Answers "where did the money actually go," which the single net-profit figure can't show alone.
6. **What's driving this — the insights feed.** 3–6 plain-language, data-grounded lines, refreshed with the range: `▲ Rebar 12mm revenue is up 42% vs last month` · `▼ Gross margin fell from 34% to 29%, mostly from discounts on Cement 50kg` · `▼ Receivables over 90 days grew by RWF 210,000 — 3 accounts newly overdue`. Each links to its underlying data. These are computed thresholds and rankings over the same read models as the rest of the room — never a model narrating freely, and never a claim about *why* beyond what's directly computable from the ledger (discount value by product is computable and fair game; a guess about customers' circumstances is not, and does not appear).
7. **Compare mode.** A `Compare` button beside the time control, for explicit side-by-side rather than the implicit single comparison above:
   - **Periods** — any two ranges (this month vs same month last year, or two custom ranges), every KPI as a side-by-side pair, trend chart overlaid aligned by day-of-period.
   - **Products or categories** — 2–4 items side by side on revenue, units, margin, trend — the direct "should I stock more of A or B" view.
   - **Locations** — the same KPI set per branch, side by side, for multi-branch businesses.
   Every compare view exports to CSV/PDF — it's the slide a manager takes into an owner meeting.

**States.** A business under ~2 weeks of history shows *"Analytics fills in as you trade. Come back after your first full week."* rather than empty charts pretending to be real. A real zero shows `RWF 0` plainly, never blank.

**Permissions.** Governed by the same `report.view` and `product.view_cost` capabilities as Reports below — a Cashier doesn't see this room; margin and cost-derived figures are hidden from anyone without `product.view_cost` even where they can see revenue.

**Data source.** Every figure and chart reads the same projections and report queries as D.10.3 Reports below — Analytics is a visual layer over the same numbers, not a separate computation. Chart and report disagreeing is a bug, not an expected difference, and the nightly projection audit (E.3) is what would catch it.

**D.10.3 Reports.** Each is a real report with a date-range selector, a location filter, comparison to a prior period, and export to CSV/PDF/XLSX:
- Sales — by day/week/month, by product, by category, by staff, by customer, by payment method, by hour of day (staffing decisions).
- Profit & margin — gross profit by product and category; margin erosion report showing where discounts ate the margin.
- Inventory — valuation (at cost and at retail), movement, shrinkage history, ageing, dead stock, reorder.
- Debtors — ageing, collections performance, worst payers, days-sales-outstanding trend.
- Creditors — ageing, upcoming payments.
- Cash flow — money in vs out by week, with a simple forward projection from known receivables and payables.
- Tax — VAT collected vs paid, per period, in the format the declaration needs.
- Staff — sales, commission, hours, variance.

**D.10.4 Ask.** A natural-language query box over the ledger. Answers arrive as: a one-sentence plain answer, the figure, a table or chart of the underlying rows, and — always — a `Show the query` disclosure so the owner can verify what was counted. Suggested prompts seeded from the business's own data (`Which customers owe me more than RWF 500,000?`). Every answer is exportable and can be scheduled: `Send me this every Monday at 7am on WhatsApp`.

**Hard rules for Ask:** it is strictly read-only — it may never write an event. Queries execute against a read replica with a row-level-security context scoped to the user's permitted locations and roles. Generated SQL is validated against an allowlist of tables and rejected if it contains DDL/DML. Results are capped and paginated. Every question and generated query is logged.

**D.10.5 Tax & compliance (Rwanda-specific, adaptable).** VAT-registered businesses must issue EBM-compliant invoices; this is the deepest moat in the product.
- Business tax profile: TIN, VAT registration status and rate, EBM/VSDC credentials, invoice numbering series.
- Every sale for a VAT-registered business generates a compliant invoice, transmitted to the revenue authority's system, with the returned signature/QR rendered on the printed and WhatsApp receipt.
- A transmission status column on every sale: Sent · Queued · Failed (with a retry). **Offline behaviour:** invoices queue locally and transmit when connectivity returns; the receipt prints with a "pending" marker per the offline rules.
- Declaration preparation: a period summary matching the required return format, with a line-by-line drill-down.
- *Implementation note: the exact EBM/VSDC integration specification, certification requirements, and offline rules must be obtained from RRA and verified before build — treat the above as the functional intent, not the interface contract.*

**D.10.6 Settings.** Business profile · locations · users & roles · products settings (costing method, default margins, tax classes, units) · payment methods & mobile-money credentials · receipt and invoice templates (logo, footer text, language) · reminder sequences · thresholds (discount approval, write-off approval, variance alert, credit limits) · notifications (who gets what, on which channel) · data (export everything, import, backups) · billing · security (2FA enforcement, session length, IP allowlist, device management).

---

### D.11 Close the Shop (day close)

**Purpose:** the day's full stop. Reconcile cash, surface the day, and produce the record.

**Flow (full-screen, stepped):**
1. **Open business check** — parked sales, unsent quotes, unreconciled MoMo, unposted stock-takes are listed with `Deal with it` / `Leave for tomorrow`.
2. **Count the till** — same denomination breakdown as the open. Expected vs counted vs variance, with a required reason if variance ≠ 0 and an immediate owner notification above threshold.
3. **The day** — a summary card: taken, by payment method, on credit, expenses, net, transaction count, busiest hour, top product, and the day's shrinkage if a stock-take was posted.
4. **Close** — `Close the shop`. The shutter animation lowers over the screen. Writes `DAY_CLOSED`.
5. **The dispatch** — the day summary is sent to the owner (and anyone subscribed) on WhatsApp automatically.

The Counter becomes read-only after close until the next day is opened. Late transactions are possible but require the day to be reopened, which is permission-gated and logged.

---

### D.12 The WhatsApp surface

WhatsApp is not a gimmick — it is the interface for the owner who isn't in the shop and the staff member without a laptop. It is a **thin, safe client onto the same ledger**, never a parallel system.

**Inbound capabilities (staff/owner, authenticated by phone number + a bound session):**
- Record a sale by text or **voice note** in Kinyarwanda, Swahili, or English: transcribe → parse to a structured draft → reply with a formatted confirmation card and buttons `✅ Record it` / `✏️ Change` / `❌ Cancel`. **Nothing is ever written to the ledger without an explicit confirmation tap.**
- Record an expense, a debt payment, or a stock-in the same way.
- Ask questions: "How much did we take today?" · "Who owes me the most?" · "Do we have 40mm elbows?"
- Photo of a supplier delivery note or receipt → parsed into a draft goods receipt or expense.

**Outbound:**
- The 7am morning brief (configurable): yesterday's take, cash position, what needs attention today, low stock, overdue debt.
- Real-time alerts by rule: large sale, large discount, till variance, negative stock, big payment received.
- The day-close dispatch.
- Customer-facing: receipts, statements, payment reminders, pay links, quote PDFs, order-ready notifications.

**Safety rules:** phone numbers are bound to a user and a role — permissions apply identically to WhatsApp; a lost-phone `Revoke this device` action exists in Team; sensitive actions (write-offs, price changes, permission changes, exports) are **not available** over WhatsApp at all; every WhatsApp-originated event is stamped with `source: whatsapp` and the message ID for audit.


---

## PART E — Data model & the event ledger

### E.1 The core principle

**Every state-changing action appends an immutable event. All balances, stock levels, and reports are derived from events.** Nothing in the product may update a quantity or a balance in place.

Consequences worth accepting deliberately:
- "Delete" is always a reversing event, never a row removal.
- "Edit" is a correction event referencing the original.
- Any figure in the product can be explained by drilling to the events that produced it.
- The system can be rebuilt from the event log alone.

### E.2 Event grammar

```
event {
  id                uuid v7 (time-ordered)
  business_id       uuid            -- tenant boundary, on every row, always
  location_id       uuid
  type              enum            -- SALE_RECORDED, PAYMENT_RECEIVED, ...
  payload           jsonb           -- versioned, schema-validated per type
  occurred_at       timestamptz     -- when it happened in the real world
  recorded_at       timestamptz     -- when we learned about it (differs when offline)
  actor_user_id     uuid
  actor_source      enum            -- web | mobile | whatsapp | api | system
  device_id         text
  correlation_id    uuid            -- groups events from one user action
  reverses_event_id uuid nullable
  corrects_event_id uuid nullable
  schema_version    int
}
```

**Event types (initial set):**
`DAY_OPENED` `DAY_CLOSED` `TILL_SESSION_OPENED` `TILL_SESSION_CLOSED`
`SALE_RECORDED` `SALE_REVERSED` `QUOTE_ISSUED` `QUOTE_CONVERTED` `RETURN_RECORDED`
`STOCK_RECEIVED` `STOCK_ISSUED` `STOCK_ADJUSTED` `STOCK_TRANSFERRED_OUT` `STOCK_TRANSFERRED_IN` `STOCK_WRITTEN_OFF` `STOCKTAKE_POSTED`
`PAYMENT_RECEIVED` `PAYMENT_MADE` `EXPENSE_RECORDED` `MONEY_TRANSFERRED` `MOMO_TRANSACTION_MATCHED`
`CUSTOMER_CREATED` `CREDIT_LIMIT_CHANGED` `DEBT_WRITTEN_OFF` `REMINDER_SENT`
`PO_CREATED` `PO_SENT` `GOODS_RECEIVED` `SUPPLIER_INVOICE_RECORDED`
`PRICE_CHANGED` `PRODUCT_CREATED` `PRODUCT_ARCHIVED`
`USER_INVITED` `ROLE_CHANGED` `PERMISSION_OVERRIDDEN` `DATA_EXPORTED` `LOGIN_SUCCEEDED` `LOGIN_FAILED`

### E.3 Read models (projections)

Maintained transactionally in the same database for consistency, not via eventual-consistency messaging (at this scale, correctness beats theoretical scalability):

`product_stock (business_id, location_id, product_id, on_hand, reserved, available, avg_cost, updated_at)`
`customer_balance (business_id, customer_id, balance, oldest_unpaid_at, limit_used)`
`supplier_balance` · `money_location_balance` · `daily_totals` · `staff_daily_totals` · `product_daily_movement`

A nightly job **recomputes every projection from the event log and diffs it against the live projection.** Any drift raises an alert. This is how you sleep at night with a derived-state architecture.

### E.4 Entity tables (state, not events)

`businesses` · `locations` · `users` · `roles` · `permissions` · `user_locations`
`products` (+ `product_aliases`, `product_units`, `product_prices`, `product_suppliers`)
`categories` · `customers` · `suppliers`
`sales` (+ `sale_lines`, `sale_payments`) · `quotes` · `returns`
`purchase_orders` (+ `po_lines`, `goods_receipts`)
`invoices` (customer + supplier) · `payments` · `expenses`
`stocktakes` (+ `stocktake_lines`) · `transfers`
`till_sessions` · `shifts` · `commission_rules` · `commission_statements`
`reminder_sequences` · `reminder_sends` · `notifications` · `tasks`
`tax_profiles` · `tax_documents` (EBM transmissions)
`audit_log` · `attachments` · `integrations` · `webhook_deliveries`

**Every table carries `business_id`.** Postgres **Row Level Security** is enabled on every one, with a policy binding `business_id` to a session variable set from the authenticated request. This is the primary defence against cross-tenant leakage — not application `WHERE` clauses, which get forgotten.

### E.5 Money and quantity handling

- Money stored as `BIGINT` minor units (RWF has no subunit in practice, but store ×100 anyway to survive currency changes and percentage maths). **Never floats.**
- Quantities as `NUMERIC(18,4)` to support fractional units (metres of cable, kg of nails).
- Every monetary column carries a currency code; multi-currency is disabled in v1 but the schema is ready.
- All rounding is explicit, half-up, applied once at the line level, with the rounding difference recorded on the sale.

---

## PART F — Permissions

### F.1 Roles (default set, fully customisable)

| Role | Intended holder | Notably can | Notably cannot |
|---|---|---|---|
| **Owner** | the proprietor | everything, incl. billing, exports, write-offs, deleting users | — |
| **Manager** | branch/shop manager | approve discounts & returns, post stock-takes, create POs, view all reports, manage staff | change billing, change owner, remove the owner, alter the audit log |
| **Cashier** | counter staff | record sales, take payments, look up stock, open/close own till | see cost prices or margins, give discounts above threshold, adjust stock, view reports |
| **Storekeeper** | stock room | receive goods, transfer, count stock, adjust with reason | sell, see customer debt, see money screens |
| **Bookkeeper** | accountant | all money screens, reconciliation, reports, exports, tax | record sales, adjust stock, change prices |
| **Viewer** | investor/spouse/accountant's clerk | read-only on reports | anything that writes |

### F.2 Permission mechanics

- Permissions are **granular capabilities** (`sale.create`, `sale.discount.over_threshold`, `product.view_cost`, `stock.adjust`, `debt.write_off`, `report.view`, `data.export`, `user.manage`, `billing.manage`, `day.reopen`, …). Roles are named bundles; individual users may have grants and revocations layered on top.
- **Scope:** every capability is scoped to one or more locations.
- **Elevation:** actions above a threshold prompt for a manager PIN inline rather than forcing a logout. The elevation is recorded on the affected event with the approving user's id — so the record shows both who did it and who allowed it.
- **Cost visibility** is its own capability, separated from everything else, because most owners will not show margin to counter staff.
- Permission changes are themselves events and appear in the activity trail.

---

## PART G — Non-functional requirements

### G.1 Security (non-negotiable baseline)

**Tenancy.** Postgres RLS on every table; the tenant id derives from the verified session, never from a request parameter. An automated test suite attempts cross-tenant access on every endpoint and fails the build if any succeeds.

**Authentication.** Argon2id password/PIN hashing. Mandatory 2FA for Owner/Manager/Bookkeeper. Short-lived access tokens (15 min) with rotating refresh tokens bound to a device; refresh reuse detection revokes the whole family. Session list with per-device revoke.

**Authorisation.** Checked server-side on every request, at the capability level, and again at the data level via RLS. The frontend hides what a user cannot do; the backend is what actually enforces it.

**Input & output.** Every request body validated against a schema (Pydantic/Zod) with unknown fields rejected. Parameterised queries exclusively — no string-built SQL anywhere, including in the Ask feature, which uses an allowlisted, validated, read-only path. Output encoding by default; a strict Content-Security-Policy with no `unsafe-inline`.

**Money integrity.** Every write that touches money or stock runs inside a single database transaction. Idempotency keys on every mutating endpoint so a retried request from a flaky connection cannot double-record a sale. Optimistic concurrency on read-modify-write paths.

**Secrets.** Nothing in the repo. Mobile-money and EBM credentials encrypted at rest with envelope encryption, per-tenant data keys, decrypted only in the request path that needs them. Key rotation supported.

**Data protection.** TLS 1.3 everywhere. Encryption at rest. PII minimised. Customer phone numbers hashed for lookup indexes. Full data export and deletion flows for the business. Retention policy per data class. Rwanda's data protection law compliance reviewed before launch.

**Webhooks & integrations.** Signature verification on every inbound webhook (mobile money, WhatsApp). Replay protection via timestamp + nonce. Outbound webhooks signed. All third-party calls have timeouts, retries with exponential backoff and jitter, and circuit breakers.

**AI-specific.** Prompt-injection defence on every model call that touches untrusted content (customer names, WhatsApp messages, OCR'd documents): untrusted content is fenced and clearly labelled as data; the model's output is never executed, only proposed to a human for confirmation. No model output writes to the ledger directly, ever. Model calls have per-tenant rate and cost limits.

**Auditing.** Append-only audit log with hash chaining so tampering is detectable. Logs shipped off-box. Every export, permission change, and login is recorded.

**Operations.** Dependency scanning and SAST in CI. Secrets scanning on every commit. Automated backups with tested restores (a restore drill is part of the release checklist, not a wiki page). Rate limiting per IP, per user, per tenant.

### G.2 Scalability

Target shape: 10,000 businesses, average 8 users and 400 transactions/day, peaking at 5,000 concurrent users. That is a *modest* load — the risk is not scale, it is bad shape. So:

- **Postgres as the single source of truth**, with read replicas for reports and Ask. Partition the events table by month; index on `(business_id, occurred_at)`, `(business_id, type, occurred_at)`.
- **Projections maintained in-transaction**, so no cache invalidation problem for the numbers that must be right.
- **Redis** for sessions, rate limiting, idempotency keys, and short-lived caches of read-heavy but non-critical data (product search).
- **A job queue** (Celery/RQ or equivalent) for anything slow or external: reminders, WhatsApp sends, EBM transmission, imports, exports, report generation, nightly projection audits. Jobs are idempotent and retryable with dead-letter handling.
- **Stateless API servers** behind a load balancer; horizontal scaling by container count.
- **Offline-first client** (see G.3) — the biggest resilience win in this market is not needing the server at all for a few hours.
- **Per-tenant resource limits** so one business's bulk import cannot degrade another's counter.
- Object storage (S3-compatible) for attachments, receipts, and exports, served via signed URLs.

### G.3 Offline & connectivity

Power cuts and dead data bundles are normal, not edge cases. The Counter must work offline.

- The client keeps a local store (IndexedDB) of products, prices, customers, and the current day's transactions.
- Sales recorded offline are queued with a client-generated idempotency key and an `occurred_at` from the device clock (with server-side clock-skew correction on sync).
- Conflict rules: stock can go negative offline and is reconciled on sync with a flagged discrepancy rather than a silent overwrite. Prices are taken from the last synced price list, and any sale made at a stale price is flagged for review.
- A visible connection state in the top nav: `Online` · `Offline — 14 sales waiting` · `Syncing…`. Never hidden.
- EBM invoices queue and transmit on reconnection with the pending marker on the receipt.

### G.4 Performance budgets

Counter search results < 100ms from local index. Sale completion round trip < 500ms p95. Any report over a 12-month range < 3s p95. First contentful paint on the Counter < 1.5s on a mid-range Android over 3G. Bundle budget: < 250KB gzipped for the initial route.

### G.5 Accessibility & quality floor

WCAG 2.2 AA: contrast checked for every token pair actually used (`--tape` on `--ink` and `--steel` combinations verified), full keyboard operation of the Counter without a mouse, visible focus everywhere, screen-reader labels on every icon-only control, live regions announcing basket and total changes, `prefers-reduced-motion` respected. Touch targets ≥ 44px. Tested on a real mid-range Android device, not just a desktop browser at 375px.

### G.6 Localisation

Kinyarwanda, English, French at launch; Swahili next. All strings externalised from day one — no hard-coded copy. Date, number, and currency formatting per locale. RTL not required but the layout should not actively prevent it. Receipt and reminder templates are per-language, and a customer's preferred language is stored on their record and used for everything sent to them.

---

## PART H — Build sequence

Ship in this order. Each phase is independently useful and independently sellable.

**Phase 0 — Foundations (weeks 1–3).** Monorepo, CI, auth, tenancy with RLS, the event ledger and projection engine, the design system as a component library with the shutter and tally rail, roles and permissions, audit log. Nothing user-facing is "finished" but the spine is correct and tested.

**Phase 1 — The shop (weeks 4–9).** Onboarding, products and stock, the Counter with cash and manual mobile money, day open/close and till sessions, receipts, the Overview. **This is the first sellable product**: a POS with real inventory.

**Phase 2 — The money (weeks 10–15).** Debt Book with statements and reminders, mobile-money API integration and reconciliation, expenses, Cash Box, the pay link. This is the phase that makes the product hard to leave.

**Phase 3 — The supply chain (weeks 16–20).** Suppliers, purchase orders, goods receipt with cost updates, reorder suggestions, stock-takes and shrinkage.

**Phase 4 — The workforce and the office (weeks 21–25).** Team, shifts, commission, exception reports, the full report suite, the Analytics dashboard (D.10.2), Ask.

**Phase 5 — The moat (weeks 26–32).** EBM/tax compliance, the WhatsApp surface including Kinyarwanda voice capture, offline mode hardening, multi-location.

**Phase 6 — The endgame.** Verified transaction history for thousands of businesses becomes the basis for working-capital lending in partnership with a bank or MFI. Do not build lending; build the data asset and the underwriting API on top of it.

### H.1 What to deliberately not build in v1

Accounting general ledger and journals (export to the accountant instead) · payroll processing · e-commerce storefront · loyalty programmes · manufacturing/BOM · barcode label design beyond a simple template · native mobile apps (PWA first) · dark mode · multi-currency.
