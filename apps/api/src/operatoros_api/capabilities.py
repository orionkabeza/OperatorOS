"""Granular capability model (spec F.2).

Roles are named bundles of capabilities; individual users can have grants
and revocations layered on top, each optionally scoped to one location.
This mechanism is enforced server-side via `api/deps.require_capability`,
independent of and in addition to RLS — RLS stops a query from *reaching*
another tenant's rows at all; capabilities stop a legitimately-scoped user
from doing something their role doesn't allow within their own tenant.

Phase 0 wires the mechanism and a first-pass bundle assignment matching
spec F.1's prose table. No feature endpoints exist yet to consume most of
these capabilities (H: Phase 0 is foundations-only) — the exact bundle
membership will be revisited as each phase's features land. That revision
is expected and cheap: it's a data change to DEFAULT_ROLE_CAPABILITIES /
the `roles`+`role_permissions` seed, not a mechanism change.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from operatoros_api.models.tenancy import UserGrant

# The initial capability catalogue (spec F.2's named examples plus the
# ones implied by D.1/D.3/D.4/D.6/D.9 UI copy). Seeded per-business as rows
# in `permissions` (see models/tenancy.py module docstring) at business
# creation — see scripts/seed.py.
CAPABILITIES: dict[str, str] = {
    "sale.create": "Record a sale at the Counter.",
    "sale.void": "Void or reverse a completed sale.",
    "sale.discount.over_threshold": "Apply a discount above the configured threshold.",
    "sale.price_override": "Override a product's selling price at the Counter.",
    "product.view_cost": "See cost prices and margins.",
    "product.manage": "Create, edit, or archive products.",
    "stock.adjust": "Adjust stock on hand with a reason.",
    "stock.transfer": "Transfer stock between locations.",
    "debt.write_off": "Write off a customer's debt.",
    "debt.credit_override": "Override a customer's credit limit on a sale.",
    "report.view": "View reports and analytics.",
    "data.export": "Export data (CSV/PDF/XLSX).",
    "user.manage": "Invite, edit, suspend, or remove staff.",
    "role.manage": "Change roles and permission grants.",
    "billing.manage": "Manage subscription and billing.",
    "day.open": "Open the shop for the day.",
    "day.close": "Close the shop for the day.",
    "day.reopen": "Reopen a closed day to post a late transaction.",
    "till.open": "Open a till session.",
    "till.close": "Close a till session.",
    "return.approve": "Approve a return outside the normal window.",
    # --- Phase 1 additions. Not new event types (events_registry.py is
    # fixed this phase) -- new capability keys, which capabilities.py's own
    # docstring already documents as expected per-phase growth. ---
    "return.create": "Record a return (within the normal window).",
    "customer.manage": "Edit a customer's profile or change their credit limit.",
    "stocktake.post": "Post a stock-take (write the correction movements).",
    # --- Phase 2 additions (plan §3). Same pattern as the Phase 1 block
    # above: events_registry.py is fixed this phase, these are new
    # capability keys layered on the existing mechanism, not new event
    # types. ---
    "debt.take_payment": "Take a payment against a customer's debt account.",
    "debt.back_date_payment": "Record a debt payment with a back-dated received date.",
    "debt.contact_log": "Log a call or other contact with a customer.",
    "debt.manage_reminders": "Configure reminder schedules, templates, and the pause switch.",
    "debt.send_reminder": "Send or approve a queued reminder / broadcast.",
    "cashbox.manage": "Manually update a money location's balance; configure connections.",
    "momo.connect": "Connect or disconnect a mobile-money provider.",
    "momo.reconcile": "Match, dismiss, or otherwise act on MoMo reconciliation rows.",
    "expense.record": "Record an expense.",
    "expense.approve": "Approve or reject an expense above the approval threshold.",
    "customer.broadcast": "Send a broadcast message to a customer segment.",
}

DEFAULT_ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    "owner": frozenset(CAPABILITIES.keys()),
    "manager": frozenset(
        {
            "sale.create",
            "sale.void",
            "sale.discount.over_threshold",
            "sale.price_override",
            "product.view_cost",
            "product.manage",
            "stock.adjust",
            "stock.transfer",
            "debt.write_off",
            "debt.credit_override",
            "report.view",
            "data.export",
            "user.manage",
            "day.open",
            "day.close",
            "day.reopen",
            "till.open",
            "till.close",
            "return.approve",
            "return.create",
            "customer.manage",
            "stocktake.post",
            "debt.take_payment",
            "debt.back_date_payment",
            "debt.contact_log",
            "debt.manage_reminders",
            "debt.send_reminder",
            "cashbox.manage",
            "momo.connect",
            "momo.reconcile",
            "expense.record",
            "expense.approve",
            "customer.broadcast",
        }
    ),
    "cashier": frozenset(
        {
            "sale.create",
            "till.open",
            "till.close",
            "return.create",
            "debt.take_payment",
            "debt.contact_log",
            "expense.record",
        }
    ),
    "storekeeper": frozenset(
        {"stock.adjust", "stock.transfer", "product.manage", "stocktake.post"}
    ),
    "bookkeeper": frozenset(
        {
            "report.view",
            "data.export",
            "product.view_cost",
            "debt.credit_override",
            "momo.reconcile",
            "expense.record",
        }
    ),
    "viewer": frozenset({"report.view"}),
}

ROLES_REQUIRING_2FA = frozenset({"owner", "manager", "bookkeeper"})


@dataclass(frozen=True)
class EffectiveCapabilities:
    # capability_key -> None means "all locations the user is assigned to",
    # a set means "only these location ids".
    grants: dict[str, set[str] | None]

    def has(self, key: str, location_id: str | None) -> bool:
        if key not in self.grants:
            return False
        scope = self.grants[key]
        if scope is None:
            return True
        if location_id is None:
            return len(scope) > 0
        return location_id in scope


async def resolve_effective_capabilities(
    session: AsyncSession,
    *,
    user_id: str,
    role_key: str,
    assigned_location_ids: list[str],
) -> EffectiveCapabilities:
    grants: dict[str, set[str] | None] = dict.fromkeys(
        DEFAULT_ROLE_CAPABILITIES.get(role_key, frozenset())
    )

    result = await session.execute(
        select(UserGrant).where(UserGrant.user_id == user_id).order_by(UserGrant.created_at)
    )
    for g in result.scalars():
        if g.effect == "grant":
            if g.location_id is None:
                grants[g.permission_key] = None
            else:
                existing = grants.get(g.permission_key)
                if existing is None and g.permission_key in grants:
                    continue  # already unrestricted
                grants[g.permission_key] = (existing or set()) | {g.location_id}
        elif g.effect == "revoke":
            if g.permission_key not in grants:
                continue
            existing = grants[g.permission_key]
            if g.location_id is None:
                grants.pop(g.permission_key, None)
                continue
            if existing is None:
                existing = set(assigned_location_ids)
            existing = existing - {g.location_id}
            grants[g.permission_key] = existing

    return EffectiveCapabilities(grants=grants)
