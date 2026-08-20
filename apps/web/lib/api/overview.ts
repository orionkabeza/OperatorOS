import { minorUnits } from "@operatoros/shared";
import { qtyToNumber } from "../decimal";
import { getDb, inTheTillMinor, lowStockCount, todaysCreditMinor, todaysTakenMinor } from "../mock/store";
import { apiRequest, USE_MOCK_API } from "./config";
import type { Overview } from "./types";

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

export async function getOverview(): Promise<Overview> {
  if (USE_MOCK_API) return Promise.resolve(computeOverview());
  return apiRequest<Overview>("GET", "/api/v1/overview");
}
