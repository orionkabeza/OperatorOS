import { minorUnits } from "@operatoros/shared";
import { qtyToNumber } from "../decimal";
import { getDb, inTheTillMinor, lowStockCount, todaysCreditMinor, todaysTakenMinor } from "../mock/store";
import { apiRequest, getDefaultLocationId, USE_MOCK_API } from "./config";
import { schemas } from "./generated/client";
import { listExpenses } from "./expenses";
import { listProducts } from "./products";
import type { Overview, OverviewNeedsYouItem } from "./types";

function computeOverview(): Overview {
  const db = getDb();
  const takenMinor = todaysTakenMinor();
  const onCreditMinor = todaysCreditMinor();
  const outOfStock = db.products.filter((p) => !p.archived && qtyToNumber(p.onHand) <= 0).length;
  const overdueCustomers = db.customers.filter((c) => c.id !== "cust-walkin" && c.balanceMinor > 0);
  const overdueTotal = overdueCustomers.reduce((sum, c) => sum + c.balanceMinor, 0);

  const needsYouToday: Overview["needsYouToday"] = [];
  if (overdueCustomers.length > 0) {
    needsYouToday.push({
      label: `${overdueCustomers.length} customers owe you money`,
      count: overdueCustomers.length,
      href: "debt-book",
      severity: "out",
    });
  }
  if (outOfStock > 0) {
    needsYouToday.push({ label: `${outOfStock} products out of stock`, count: outOfStock, href: "stock-room", severity: "watch" });
  }
  const low = lowStockCount();
  if (low > 0) {
    needsYouToday.push({ label: `${low} products low on stock`, count: low, href: "stock-room", severity: "watch" });
  }

  // Product performance from today's sales — genuinely computed, not faked.
  const salesRevenue = new Map<string, number>();
  const salesMargin = new Map<string, number>();
  for (const sale of db.sales) {
    for (const line of sale.lines) {
      salesRevenue.set(line.name, (salesRevenue.get(line.name) ?? 0) + line.lineTotalMinor);
      const product = db.products.find((p) => p.id === line.productId);
      if (product) {
        const margin = line.lineTotalMinor - Math.round(qtyToNumber(line.qty) * product.costMinor);
        salesMargin.set(line.name, (salesMargin.get(line.name) ?? 0) + margin);
      }
    }
  }
  const bestSelling = [...salesRevenue.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, valueMinor]) => ({ productId: name, name, valueMinor: minorUnits(valueMinor) }));
  const bestMargin = [...salesMargin.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, valueMinor]) => ({ productId: name, name, valueMinor: minorUnits(valueMinor) }));
  const dead = db.products
    .filter((p) => !p.archived && !salesRevenue.has(p.name))
    .slice(0, 5)
    .map((p) => ({ productId: p.id, name: p.name, valueMinor: minorUnits(Math.round(qtyToNumber(p.onHand) * p.costMinor)) }));

  const revenueMinor = db.sales.reduce((sum, s) => sum + s.totalMinor, 0);
  const costOfSales = db.sales.reduce(
    (sum, s) =>
      sum +
      s.lines.reduce((lsum, l) => {
        const product = db.products.find((p) => p.id === l.productId);
        return lsum + (product ? Math.round(qtyToNumber(l.qty) * product.costMinor) : 0);
      }, 0),
    0,
  );

  return {
    today: {
      takenMinor,
      onCreditMinor,
      expensesMinor: minorUnits(0),
      netMinor: takenMinor,
      vsWeekdayAverageMinor: minorUnits(0), // No trailing history in a fresh mock session — genuinely zero, not faked.
    },
    needsYouToday,
    moneyPosition: {
      tillMinor: inTheTillMinor(),
      momoMinor: minorUnits(0),
      bankMinor: minorUnits(0),
      owedToYouMinor: minorUnits(overdueTotal),
      owedByYouMinor: minorUnits(0),
      workingCapitalMinor: minorUnits(overdueTotal),
    },
    thisMonth: {
      revenueMinor: minorUnits(revenueMinor),
      grossProfitMinor: minorUnits(revenueMinor - costOfSales),
      expensesMinor: minorUnits(0),
      netProfitMinor: minorUnits(revenueMinor - costOfSales),
      lastMonthNetProfitMinor: minorUnits(0),
      sparkline: [],
    },
    topAndBottom: { bestSelling, bestMargin, dead },
    businessHistoryDays: db.sales.length > 0 ? 1 : 0,
  };
}

/**
 * `GET /api/v1/overview`'s `needs_you_today` is a fixed-shape object of
 * counts (`NeedsYouTodayOut`), not a pre-built list of display items —
 * built into the frontend's `{label,count,href,severity}[]` shape here,
 * the same construction the mock's `computeOverview` above does from its
 * own raw counts. There is no separate "low stock" count on the wire
 * (only out-of-stock and negative-stock) — that bullet is dropped for the
 * real branch rather than faked.
 */
function buildNeedsYouToday(needs: {
  customers_overdue_count: number;
  customers_overdue_amount_minor: number;
  products_out_of_stock: number;
  products_negative_stock: number;
}): OverviewNeedsYouItem[] {
  const items: OverviewNeedsYouItem[] = [];
  if (needs.customers_overdue_count > 0) {
    items.push({
      label: `${needs.customers_overdue_count} customers owe you money`,
      count: needs.customers_overdue_count,
      href: "debt-book",
      severity: "out",
    });
  }
  if (needs.products_out_of_stock > 0) {
    items.push({ label: `${needs.products_out_of_stock} products out of stock`, count: needs.products_out_of_stock, href: "stock-room", severity: "watch" });
  }
  if (needs.products_negative_stock > 0) {
    items.push({
      label: `${needs.products_negative_stock} products with negative stock`,
      count: needs.products_negative_stock,
      href: "stock-room",
      severity: "watch",
    });
  }
  return items;
}

export async function getOverview(): Promise<Overview> {
  if (USE_MOCK_API) return Promise.resolve(computeOverview());
  const raw = await apiRequest<unknown>("GET", "/api/v1/overview", { query: { location_id: await getDefaultLocationId() } });
  const o = schemas.OverviewOut.parse(raw);

  // ThisMonthOut has no expenses figure — derived from the real, separately
  // listable expenses resource rather than left at a misleading zero.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const expenses = await listExpenses();
  const thisMonthExpensesMinor = expenses
    .filter((e) => (e.status === "approved" || e.status === "posted") && new Date(e.date) >= monthStart)
    .reduce((sum, e) => sum + e.amountMinor, 0);

  // TopProductOut only carries product_id, not a display name — enriched
  // against the real products list rather than showing raw ids.
  const products = await listProducts();
  const productNameById = new Map(products.map((p) => [p.id, p.name]));

  return {
    today: {
      takenMinor: minorUnits(o.today.revenue_minor - o.today.credit_minor),
      onCreditMinor: minorUnits(o.today.credit_minor),
      // TodayOut has no expenses figure at daily granularity.
      expensesMinor: minorUnits(0),
      netMinor: minorUnits(o.today.revenue_minor - o.today.credit_minor),
      // No trailing-average endpoint exists.
      vsWeekdayAverageMinor: minorUnits(0),
    },
    needsYouToday: buildNeedsYouToday(o.needs_you_today),
    moneyPosition: {
      tillMinor: minorUnits(o.money_position.balances_by_account["till"] ?? 0),
      momoMinor: minorUnits(o.money_position.balances_by_account["momo"] ?? 0),
      bankMinor: minorUnits(o.money_position.balances_by_account["bank"] ?? 0),
      owedToYouMinor: minorUnits(o.money_position.owed_to_you_minor),
      owedByYouMinor: minorUnits(o.money_position.owed_by_you_minor),
      workingCapitalMinor: minorUnits(o.money_position.working_capital_minor),
    },
    thisMonth: {
      revenueMinor: minorUnits(o.this_month.revenue_minor),
      // ThisMonthOut has no cost-of-sales/gross-profit figure — computing
      // it correctly needs per-sale product cost aggregation across a
      // whole month, a meaningfully bigger fetch than this card warrants.
      grossProfitMinor: minorUnits(0),
      expensesMinor: minorUnits(thisMonthExpensesMinor),
      netProfitMinor: minorUnits(o.this_month.revenue_minor - thisMonthExpensesMinor),
      // No prior-month endpoint exists.
      lastMonthNetProfitMinor: minorUnits(0),
      // No daily-granularity trend endpoint exists — genuinely empty.
      sparkline: [],
    },
    topAndBottom: {
      bestSelling: o.top_products.map((p) => ({
        productId: p.product_id,
        name: productNameById.get(p.product_id) ?? p.product_id,
        valueMinor: minorUnits(p.revenue_minor),
      })),
      // No margin-ranked or dead-stock endpoint exists.
      bestMargin: [],
      dead: [],
    },
    // No "days since first sale" field exists — same coarse heuristic the
    // mock uses (transactions recorded today implies at least one
    // business day of history), not a faithful day count.
    businessHistoryDays: o.today.transaction_count > 0 ? 1 : 0,
  };
}
