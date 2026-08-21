"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { OpenShopModal } from "../day/OpenShopModal";
import { TillSessionModal } from "../day/TillSessionModal";
import { EmptyState } from "../design/EmptyState";
import { ROOMS } from "@/lib/rooms";

// Each room is its own chunk, loaded only when a cashier actually opens
// it — a shift that never touches Stock Room shouldn't pay to download it.
// See docs/DECISIONS.md (bundle-budget note, spec G's <250KB-gzipped
// initial-route budget).
const Counter = dynamic(() => import("../counter/Counter").then((m) => m.Counter), { ssr: false });
const StockRoom = dynamic(() => import("../stock/StockRoom").then((m) => m.StockRoom), { ssr: false });
const DebtBook = dynamic(() => import("../debt/DebtBook").then((m) => m.DebtBook), { ssr: false });
const CashBox = dynamic(() => import("../cashbox/CashBox").then((m) => m.CashBox), { ssr: false });
const BackOffice = dynamic(() => import("../overview/BackOffice").then((m) => m.BackOffice), { ssr: false });
const CloseShopFlow = dynamic(
  () => import("../day/CloseShopFlow").then((m) => m.CloseShopFlow),
  { ssr: false },
);
import { useDayStatus } from "@/lib/queries/day";
import { RoomNav } from "./RoomNav";
import { TallyRail } from "./TallyRail";
import { TopNav } from "./TopNav";

const KNOWN_ROOMS = ["counter", "stock-room", "debt-book", "cash-box", "back-office"];

const EMPTY_MESSAGES: Record<string, string> = {
  suppliers: "No suppliers yet. Purchase orders and goods receipt land in Phase 3.",
  team: "No staff activity yet. Shifts, commission, and the exception report land in Phase 4.",
};

export function ShopFloor() {
  const [activeRoom, setActiveRoom] = useState("counter");
  const [closingShop, setClosingShop] = useState(false);
  const [openShopDeferred, setOpenShopDeferred] = useState(false);
  const room = ROOMS.find((r) => r.id === activeRoom) ?? ROOMS[0];
  const { data: day } = useDayStatus();

  // D.3 trigger: "first sign-in of the day... or manually from the day-status
  // pill" — approximated here as "shown once per session unless the user
  // explicitly deferred it," since Phase 1 has no real per-user daily
  // sign-in event distinct from the demo auth's session.
  const showOpenShop = day?.status === "closed" && !openShopDeferred;

  if (closingShop) {
    return <CloseShopFlow onDone={() => setClosingShop(false)} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav dayStatus={day} />
      <TallyRail activeKey={room?.tallyKey} />
      <div className="flex flex-1">
        <RoomNav activeRoom={activeRoom} onSelectRoom={setActiveRoom} onCloseShop={() => setClosingShop(true)} />
        <main className="flex-1 overflow-x-hidden bg-floor p-16 md:p-32">
          <h1 className="type-expanded mb-24 font-display text-screen-title font-bold text-ink">{room?.label}</h1>
          {activeRoom === "counter" ? <Counter /> : null}
          {activeRoom === "stock-room" ? <StockRoom /> : null}
          {activeRoom === "debt-book" ? <DebtBook /> : null}
          {activeRoom === "cash-box" ? <CashBox /> : null}
          {activeRoom === "back-office" ? <BackOffice /> : null}
          {!KNOWN_ROOMS.includes(activeRoom) ? <EmptyState statement={EMPTY_MESSAGES[activeRoom] ?? "Nothing here yet."} /> : null}
        </main>
      </div>
      <OpenShopModal open={Boolean(showOpenShop)} onDeferred={() => setOpenShopDeferred(true)} />
      <TillSessionModal />
    </div>
  );
}
