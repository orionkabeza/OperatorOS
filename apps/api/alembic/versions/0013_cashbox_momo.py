"""phase 2: momo_provider_credentials, momo_transactions, momo_webhook_nonces, pay_links

Revision ID: 0013_cashbox_momo
Revises: 0012_debt_book
Create Date: 2026-08-21

Plan §1, migration group 3 (momo staging/credentials/pay_links). All four
tables are plain RLS-protected entity tables -- none are projections, none
get the `reject_direct_projection_write()` trigger.

`pay_links` needs no `token` column and no RLS exception: the public
`/pay/{token}` page resolves its token as a signed JWT
(`security/tokens.py::decode_pay_link_token`) that directly names
`business_id` and the row's `id` once its signature verifies -- the
tenant is known before any query runs, so ordinary RLS
`ENABLE`+`FORCE` (bound to that resolved `business_id`, same as every
other tenant table) is sufficient. See models/paylink.py's docstring and
docs/DECISIONS.md.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0013_cashbox_momo"
down_revision: str | None = "0012_debt_book"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = [
    "momo_provider_credentials",
    "momo_transactions",
    "momo_webhook_nonces",
    "pay_links",
]


def _add_rls(conn, table_name: str) -> None:
    conn.execute(text(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY'))
    conn.execute(text(f'ALTER TABLE "{table_name}" FORCE ROW LEVEL SECURITY'))
    conn.execute(
        text(
            f'CREATE POLICY tenant_isolation ON "{table_name}" '
            f"USING (business_id = current_setting('app.business_id', true)) "
            f"WITH CHECK (business_id = current_setting('app.business_id', true))"
        )
    )
    conn.execute(text(f'GRANT SELECT, INSERT, UPDATE, DELETE ON "{table_name}" TO operatoros_app'))


def upgrade() -> None:
    from operatoros_api.models.momo import MomoProviderCredential, MomoTransaction, MomoWebhookNonce
    from operatoros_api.models.paylink import PayLink

    conn = op.get_bind()
    MomoProviderCredential.metadata.create_all(
        bind=conn,
        tables=[
            MomoProviderCredential.__table__,
            MomoTransaction.__table__,
            MomoWebhookNonce.__table__,
            PayLink.__table__,
        ],
    )

    for table_name in TABLES:
        _add_rls(conn, table_name)


def downgrade() -> None:
    conn = op.get_bind()
    for table_name in reversed(TABLES):
        conn.execute(text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table_name}"'))
    for table_name in reversed(TABLES):
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
