"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { minorUnits } from "@operatoros/shared";
import { useMemo, useState } from "react";
import { Basket } from "./Basket";
import { CategorySidebar } from "./CategorySidebar";
import { CreateOneOffModal } from "./CreateOneOffModal";
import { Drawer } from "../design/Drawer";
import { Money } from "../design/Money";
import { EmptyState } from "../design/EmptyState";
import { ParkedTabs } from "./ParkedTabs";
import { ProductGrid } from "./ProductGrid";
import { ProductSearchBar } from "./ProductSearchBar";
import { QuotesPanel } from "./QuotesPanel";
import { ReturnsPanel } from "./ReturnsPanel";
import { TakePaymentDrawer } from "./TakePaymentDrawer";
import { discountFromPercent, grandTotalMinor, subtotalMinor, vatMinor } from "@/lib/basket-math";
import { BUSINESS_VAT_REGISTERED, VAT_RATE_PERCENT } from "@/lib/constants";
import { useDayStatus } from "@/lib/queries/day";
import { useCategories, useProducts } from "@/lib/queries/products";
import { useCustomer } from "@/lib/queries/customers";
import { useIssueQuote, useParkSale, useRecordSale, useUndoSale } from "@/lib/queries/sales";
import { useBasketStore } from "@/lib/stores/basket-store";
import { useToastStore } from "@/lib/toast-store";
import { useIsDesktopBasket } from "@/lib/use-media-query";
import type { PaymentLineInput, Product, ReceiptChannel } from "@/lib/api/types";

/** D.4 — the Counter. Three columns on desktop, collapsing on tablet, bottom-sheet basket on mobile. */
export function Counter() {
  const [tab, setTab] = useState<"sell" | "returns" | "quotes">("sell");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focusSignal, setFocusSignal] = useState(0);
  const [focusQtyLineId, setFocusQtyLineId] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [mobileBasketOpen, setMobileBasketOpen] = useState(false);
  const [oneOffModal, setOneOffModal] = useState<{ name: string; oneOff: boolean } | null>(null);

  const { data: day } = useDayStatus();
  const { data: categories } = useCategories();
  const { data: allProducts } = useProducts();
  const { data: filteredProducts } = useProducts({ categoryId: categoryId ?? undefined, search: query || undefined });
  const { data: customer } = useCustomer(useBasketStore((s) => s.customerId));

  const addLine = useBasketStore((s) => s.addLine);
  const lines = useBasketStore((s) => s.lines);
  const basketDiscount = useBasketStore((s) => s.discount);
  const clearBasket = useBasketStore((s) => s.clear);

  const recordSale = useRecordSale();
  const undoSale = useUndoSale();
  const parkSale = useParkSale();
  const issueQuote = useIssueQuote();
  const pushToast = useToastStore((s) => s.push);

  const dayOpen = day?.status === "open";
  const subtotal = subtotalMinor(lines);
  const discountMinorValue =
    basketDiscount.mode === "percent" ? discountFromPercent(subtotal, basketDiscount.value) : minorUnits(basketDiscount.value);
  const vat = vatMinor(subtotal, discountMinorValue, { registered: BUSINESS_VAT_REGISTERED, ratePercent: VAT_RATE_PERCENT });
  const total = grandTotalMinor(subtotal, discountMinorValue, vat);

  const topResult = useMemo(() => filteredProducts?.[0] ?? null, [filteredProducts]);

  function handleAddProduct(product: Product, opts?: { openQtyField?: boolean }) {
    addLine({
      productId: product.id,
      name: product.name,
      qty: "1",
      unitId: product.unitId,
      unitPriceMinor: product.priceMinor,
    });
    if (opts?.openQtyField) {
      // The newly added/merged line is looked up after the store updates.
      requestAnimationFrame(() => {
        const line = useBasketStore.getState().lines.find((l) => l.productId === product.id && l.unitId === product.unitId);
        if (line) setFocusQtyLineId(line.lineId);
      });
    }
  }

  async function handleCompletePayment(payments: PaymentLineInput[], receiptChannel: ReceiptChannel) {
    const customerId = useBasketStore.getState().customerId;
    const currentLines = useBasketStore.getState().lines;
    const { managerPin, managerUserId } = useBasketStore.getState().discount;
    const sale = await recordSale.mutateAsync({
      lines: currentLines.map(({ lineId, note, ...rest }) => ({ ...rest, ...(note ? { note } : {}) })),
      customerId,
      discountMinor: discountMinorValue,
      // Only meaningful when the discount crossed the approval threshold;
      // apps/api ignores them otherwise.
      ...(managerPin ? { discountManagerPin: managerPin } : {}),
      ...(managerUserId ? { discountManagerUserId: managerUserId } : {}),
      payments,
      receiptChannel,
    });
    pushToast({
      message: `Sale saved — receipt #${sale.receiptNumber}`,
      onUndo: () => void undoSale.mutateAsync(sale.id),
      durationMs: 20_000,
    });
    clearBasket();
    setQuery("");
    setFocusSignal((s) => s + 1);
  }

  function handleNoMatch(name: string, oneOff: boolean) {
    setOneOffModal({ name, oneOff });
  }

  function handleParkSale(closeMobileDrawer: boolean) {
    void parkSale
      .mutateAsync({
        label: `Parked ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
        lines: lines.map(({ lineId, ...rest }) => rest),
        customerId: useBasketStore.getState().customerId,
      })
      .then(() => {
        clearBasket();
        if (closeMobileDrawer) setMobileBasketOpen(false);
        pushToast({ message: "Sale parked." });
      });
  }

  function handleSaveQuote(closeMobileDrawer: boolean) {
    void issueQuote
      .mutateAsync({ lines: lines.map(({ lineId, ...rest }) => rest), customerId: useBasketStore.getState().customerId, totalMinor: total })
      .then((quote) => {
        clearBasket();
        if (closeMobileDrawer) setMobileBasketOpen(false);
        pushToast({ message: `Quote saved — ${quote.quoteNumber}` });
      });
  }

  // Real conditional mounting (not just CSS `hidden`) — mounting both the
  // desktop inline column and the mobile bottom-sheet copy of <Basket>
  // simultaneously created two DOM nodes sharing the same ARIA landmark
  // label ("Basket"), a genuine accessibility/testability bug found via
  // Playwright at 375px width (one was merely display:none, not absent).
  const isDesktopBasket = useIsDesktopBasket();

  return (
    <div className="flex flex-col gap-16">
      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <Tabs.List aria-label="Counter sections" className="flex gap-4 border-b border-rule">
          {(["sell", "returns", "quotes"] as const).map((t) => (
            <Tabs.Trigger
              key={t}
              value={t}
              className="border-b-2 border-transparent px-16 py-8 text-table font-semibold uppercase tracking-wide text-ink-soft data-[state=active]:border-tape data-[state=active]:text-ink"
            >
              {t === "sell" ? "Sell" : t === "returns" ? "Returns" : "Quotes"}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="sell" className="pt-16">
          {!dayOpen ? (
            <div className="mb-16">
              <EmptyState statement="The shop isn't open yet. Open the day from the status pill above before selling." />
            </div>
          ) : null}

          <ParkedTabs />

          <div className="mt-16 flex flex-col gap-16 lg:flex-row">
            <CategorySidebar categories={categories ?? []} activeCategoryId={categoryId} onSelect={setCategoryId} />

            <div className="flex min-w-0 flex-1 flex-col gap-16 lg:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-16">
                <ProductSearchBar
                  allProducts={allProducts ?? []}
                  topResult={topResult}
                  query={query}
                  onQueryChange={setQuery}
                  onAdd={handleAddProduct}
                  onCreateOneOff={handleNoMatch}
                  focusSignal={focusSignal}
                />
                <ProductGrid
                  products={filteredProducts ?? []}
                  onAdd={handleAddProduct}
                  onSellAnyway={(p) => handleAddProduct(p)}
                />
              </div>

              {isDesktopBasket ? (
                <div className="w-basket shrink-0">
                  <Basket
                    products={allProducts ?? []}
                    dayOpen={Boolean(dayOpen)}
                    onTakePayment={() => setPaymentOpen(true)}
                    onParkSale={() => handleParkSale(false)}
                    onSaveQuote={() => handleSaveQuote(false)}
                    focusQtyLineId={focusQtyLineId}
                  />
                </div>
              ) : null}
            </div>
          </div>

          {/* Mobile: persistent bottom bar expanding into a bottom-sheet basket — D.4. */}
          {!isDesktopBasket && lines.length > 0 ? (
            <button
              type="button"
              onClick={() => setMobileBasketOpen(true)}
              aria-label="Open basket"
              className="fixed inset-x-0 bottom-0 z-30 flex h-control-lg items-center justify-between bg-steel px-16 text-white"
            >
              <span className="text-table font-semibold">
                {lines.length} {lines.length === 1 ? "item" : "items"}
              </span>
              <Money amount={total} surface="dark" />
            </button>
          ) : null}

          {!isDesktopBasket ? (
            <Drawer open={mobileBasketOpen} onOpenChange={setMobileBasketOpen} title="Basket">
              <Basket
                products={allProducts ?? []}
                dayOpen={Boolean(dayOpen)}
                onTakePayment={() => {
                  setMobileBasketOpen(false);
                  setPaymentOpen(true);
                }}
                onParkSale={() => handleParkSale(true)}
                onSaveQuote={() => handleSaveQuote(true)}
                focusQtyLineId={focusQtyLineId}
              />
            </Drawer>
          ) : null}

          <TakePaymentDrawer
            open={paymentOpen}
            onClose={() => setPaymentOpen(false)}
            totalMinor={total}
            customer={customer}
            onComplete={handleCompletePayment}
          />

          {oneOffModal ? (
            <CreateOneOffModal
              open
              name={oneOffModal.name}
              oneOff={oneOffModal.oneOff}
              onClose={() => setOneOffModal(null)}
              onCreated={(product) => {
                handleAddProduct(product);
                setOneOffModal(null);
                setQuery("");
              }}
            />
          ) : null}
        </Tabs.Content>

        <Tabs.Content value="returns" className="pt-16">
          <ReturnsPanel />
        </Tabs.Content>

        <Tabs.Content value="quotes" className="pt-16">
          <QuotesPanel />
        </Tabs.Content>
      </Tabs.Root>
      <div aria-live="polite" className="sr-only">
        {lines.length} items in basket, total <Money amount={total} />
      </div>
    </div>
  );
}
