from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class CategoryCreate(ApiModel):
    name: str


class CategoryOut(ApiModel):
    id: str
    name: str


class UnitCreate(ApiModel):
    name: str
    symbol: str


class UnitOut(ApiModel):
    id: str
    name: str
    symbol: str


class ProductCreate(ApiModel):
    name: str
    base_unit_id: str
    category_id: str | None = None
    sku: str | None = None
    barcode: str | None = None
    cost_price_minor: int = 0
    selling_price_minor: int = 0
    min_selling_price_minor: int | None = None
    tax_class: str = "standard"
    reorder_point: str = "0"
    reorder_quantity: str = "0"
    notes: str | None = None
    aliases: list[str] = []
    opening_quantity: str | None = None
    opening_location_id: str | None = None


class ProductUpdate(ApiModel):
    name: str | None = None
    category_id: str | None = None
    sku: str | None = None
    barcode: str | None = None
    min_selling_price_minor: int | None = None
    tax_class: str | None = None
    reorder_point: str | None = None
    reorder_quantity: str | None = None
    notes: str | None = None


class PriceChangeRequest(ApiModel):
    new_selling_price_minor: int
    reason: str | None = None


class ProductOut(ApiModel):
    id: str
    name: str
    sku: str | None
    barcode: str | None
    category_id: str | None
    base_unit_id: str
    # Cost/margin are visibility-gated (spec F.2: "Cost visibility is its
    # own capability") -- None when the caller lacks product.view_cost,
    # never a real 0 that could be misread as "this costs nothing".
    cost_price_minor: int | None = None
    selling_price_minor: int
    min_selling_price_minor: int | None
    tax_class: str
    reorder_point: str
    reorder_quantity: str
    status: str
    aliases: list[str] = []


class ProductStockOut(ApiModel):
    product_id: str
    location_id: str
    on_hand: str
    reserved: str
    available: str
    avg_cost_minor: int


class BulkPriceAdjustRequest(ApiModel):
    product_ids: list[str]
    percent: str | None = None
    amount_minor: int | None = None


class BulkCategoryChangeRequest(ApiModel):
    product_ids: list[str]
    category_id: str | None


class ImportPreviewRow(ApiModel):
    row_number: int
    name: str | None = None
    sku: str | None = None
    barcode: str | None = None
    category: str | None = None
    unit: str | None = None
    cost_price_minor: int | None = None
    selling_price_minor: int | None = None
    opening_quantity: str | None = None
    errors: list[str] = []
    is_duplicate: bool = False


class ImportPreviewResult(ApiModel):
    """No server-side staging token (see product_import.py's module
    docstring for the trade-off) -- `/commit` re-sends this same `preview`
    list back (with any corrections applied) rather than the API holding
    state between the two calls."""

    total_rows: int
    valid_rows: int
    error_rows: int
    duplicate_rows: int
    preview: list[ImportPreviewRow]


class ImportCommitRequest(ApiModel):
    rows: list[ImportPreviewRow]
    default_unit_id: str
    opening_location_id: str | None = None


class CorrectedTemplateRequest(ApiModel):
    rows: list[ImportPreviewRow]


class CorrectedTemplateResult(ApiModel):
    csv: str


class ImportCommitResult(ApiModel):
    created: int
    skipped: int
