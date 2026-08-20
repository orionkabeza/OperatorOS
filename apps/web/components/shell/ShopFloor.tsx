"use client";

import { useState } from "react";
import { Counter } from "../counter/Counter";
import { CloseShopFlow } from "../day/CloseShopFlow";
import { OpenShopModal } from "../day/OpenShopModal";
import { TillSessionModal } from "../day/TillSessionModal";
import { EmptyState } from "../design/EmptyState";
import { StockRoom } from "../stock/StockRoom";
import { Overview } from "../overview/Overview";
import { ROOMS } from "@/lib/rooms";
import { useDayStatus } from "@/lib/queries/day";
import { RoomNav } from "./RoomNav";
import { TallyRail } from "./TallyRail";
import { TopNav } from "./TopNav";

const EMPTY_MESSAGES: Record<string, string> = {
  "debt-book": "No one owes you anything right now. Credit sales and reminders land in Phase 2.",
  "cash-box": "No money movements yet. Till, MoMo, and bank tracking land in Phase 2.",
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
          {activeRoom === "back-office" ? <Overview /> : null}
          {activeRoom !== "counter" && activeRoom !== "stock-room" && activeRoom !== "back-office" ? (
            <EmptyState statement={EMPTY_MESSAGES[activeRoom] ?? "Nothing here yet."} />
          ) : null}
        </main>
      </div>
      <OpenShopModal open={Boolean(showOpenShop)} onDeferred={() => setOpenShopDeferred(true)} />
      <TillSessionModal />
    </div>
  );
}
