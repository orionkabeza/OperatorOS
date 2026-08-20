"use client";

import { useState } from "react";
import { EmptyState } from "../design/EmptyState";
import { ROOMS } from "@/lib/rooms";
import { RoomNav } from "./RoomNav";
import { TallyRail } from "./TallyRail";
import { TopNav } from "./TopNav";

const EMPTY_MESSAGES: Record<string, string> = {
  counter: "Nothing rings up here yet. The Counter — sell, quote, return — lands in Phase 1.",
  "stock-room": "No stock tracked yet. Products, cost, and stock movements land in Phase 1.",
  "debt-book":
    "No one owes you anything right now. Credit sales and reminders land in Phase 2.",
  "cash-box": "No money movements yet. Till, MoMo, and bank tracking land in Phase 2.",
  suppliers: "No suppliers yet. Purchase orders and goods receipt land in Phase 3.",
  team: "No staff activity yet. Shifts, commission, and the exception report land in Phase 4.",
  "back-office": "Nothing to report yet. Analytics, reports, and Ask land in Phase 4.",
};

export function ShopFloor() {
  const [activeRoom, setActiveRoom] = useState("counter");
  const room = ROOMS.find((r) => r.id === activeRoom) ?? ROOMS[0];

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <TallyRail activeKey={room?.tallyKey} />
      <div className="flex flex-1">
        <RoomNav
          activeRoom={activeRoom}
          onSelectRoom={setActiveRoom}
          onCloseShop={() => setActiveRoom("back-office")}
        />
        <main className="flex-1 overflow-x-hidden bg-floor p-16 md:p-32">
          <h1 className="type-expanded mb-24 font-display text-screen-title font-bold text-ink">
            {room?.label}
          </h1>
          <EmptyState statement={EMPTY_MESSAGES[activeRoom] ?? "Nothing here yet."} />
        </main>
      </div>
    </div>
  );
}
