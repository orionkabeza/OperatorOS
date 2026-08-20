"use client";

import { Card } from "../design/Card";
import { Money } from "../design/Money";
import { useOverview } from "@/lib/queries/overview";

/** D.10.1 — "not a wall of charts": a single scannable column, phone-first. Lives in Back Office's default tab. */
export function Overview() {
  const { data, isLoading } = useOverview();

  if (isLoading || !data) {
    return <p className="text-body text-ink-soft">Loading…</p>;
  }

  const { today, needsYouToday, moneyPosition, thisMonth, topAndBottom } = data;

  return (
    <div className="flex max-w-form flex-col gap-16">
      <Card eyebrow="Today" title="Today">
        <div className="grid grid-cols-2 gap-16 sm:grid-cols-4">
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Taken</p>
            <Money amount={today.takenMinor} size="card-title" />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">On credit</p>
            <Money amount={today.onCreditMinor} size="card-title" />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Expenses</p>
            <Money amount={today.expensesMinor} size="card-title" />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Net</p>
            <Money amount={today.netMinor} size="card-title" />
          </div>
        </div>
      </Card>

      <Card eyebrow="Needs you today" title="Needs you today">
        {needsYouToday.length === 0 ? (
          <p className="text-body text-ink-soft">Nothing needs your attention right now.</p>
        ) : (
          <ul className="flex flex-col gap-8">
            {needsYouToday.map((item, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className={`text-body ${item.severity === "out" ? "text-out" : "text-watch"}`}>{item.label}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card eyebrow="Money position" title="Money position">
        <div className="grid grid-cols-2 gap-16 sm:grid-cols-3">
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Till</p>
            <Money amount={moneyPosition.tillMinor} />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">MoMo</p>
            <Money amount={moneyPosition.momoMinor} />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Bank</p>
            <Money amount={moneyPosition.bankMinor} />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Owed to you</p>
            <Money amount={moneyPosition.owedToYouMinor} />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Owed by you</p>
            <Money amount={moneyPosition.owedByYouMinor} emphasis={moneyPosition.owedByYouMinor > 0 ? "out" : undefined} />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Working capital</p>
            <Money amount={moneyPosition.workingCapitalMinor} size="card-title" />
          </div>
        </div>
      </Card>

      <Card eyebrow="This month" title="This month">
        <div className="grid grid-cols-2 gap-16 sm:grid-cols-4">
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Revenue</p>
            <Money amount={thisMonth.revenueMinor} />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Gross profit</p>
            <Money amount={thisMonth.grossProfitMinor} />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Expenses</p>
            <Money amount={thisMonth.expensesMinor} />
          </div>
          <div>
            <p className="text-micro uppercase tracking-tracked text-ink-soft">Net profit</p>
            <Money amount={thisMonth.netProfitMinor} />
          </div>
        </div>
        <p className="mt-8 text-meta text-ink-soft">
          Last month: <Money amount={thisMonth.lastMonthNetProfitMinor} className="inline" />
        </p>
      </Card>

      <Card eyebrow="Top and bottom" title="Top and bottom">
        <div className="flex flex-col gap-16">
          <div>
            <p className="mb-4 text-table font-semibold text-ink">Best-selling</p>
            {topAndBottom.bestSelling.length === 0 ? (
              <p className="text-meta text-ink-soft">No sales yet.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {topAndBottom.bestSelling.map((p) => (
                  <li key={p.productId} className="flex items-center justify-between text-table">
                    <span className="text-ink">{p.name}</span>
                    <Money amount={p.valueMinor} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-4 text-table font-semibold text-ink">Best margin</p>
            {topAndBottom.bestMargin.length === 0 ? (
              <p className="text-meta text-ink-soft">No sales yet.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {topAndBottom.bestMargin.map((p) => (
                  <li key={p.productId} className="flex items-center justify-between text-table">
                    <span className="text-ink">{p.name}</span>
                    <Money amount={p.valueMinor} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-4 text-table font-semibold text-ink">Dead stock — capital tied up</p>
            {topAndBottom.dead.length === 0 ? (
              <p className="text-meta text-ink-soft">Nothing dead right now.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {topAndBottom.dead.map((p) => (
                  <li key={p.productId} className="flex items-center justify-between text-table">
                    <span className="text-ink">{p.name}</span>
                    <Money amount={p.valueMinor} emphasis="watch" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
