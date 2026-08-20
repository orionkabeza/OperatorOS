"use client";

import clsx from "clsx";
import { useState } from "react";
import { ROOMS } from "@/lib/rooms";

/**
 * B.5.3 — dark left rail, 220px (collapsible to 64px icon rail), stencilled
 * uppercase labels, 2px tape left marker on the active room. On mobile this
 * becomes a bottom bar per the spec; that variant lands with the first real
 * room screens (Phase 1+) since Phase 0 has nothing behind it to navigate to
 * yet beyond placeholders — tracked, not forgotten.
 */
export function RoomNav({
  activeRoom,
  onSelectRoom,
  onCloseShop,
}: {
  activeRoom: string;
  onSelectRoom: (id: string) => void;
  onCloseShop: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav
      aria-label="Rooms"
      className={clsx(
        "sticky top-rail flex h-screen shrink-0 flex-col bg-steel",
        collapsed ? "w-nav-collapsed" : "w-nav",
      )}
    >
      <ul className="flex flex-1 flex-col gap-px py-16">
        {ROOMS.map((room) => {
          const active = room.id === activeRoom;
          return (
            <li key={room.id}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSelectRoom(room.id)}
                className={clsx(
                  "flex h-control-lg w-full items-center gap-12 border-l-2 px-16 text-left text-table font-semibold uppercase tracking-wide",
                  active ? "border-tape bg-steel-deep text-white" : "border-transparent text-white/70 hover:text-white",
                )}
                title={collapsed ? room.label : undefined}
              >
                <span aria-hidden className="text-white/60">
                  {room.label.charAt(0)}
                </span>
                {!collapsed ? <span>{room.label}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-white/10 p-16">
        <button
          type="button"
          onClick={onCloseShop}
          className="h-control w-full rounded border border-white/30 text-table font-semibold uppercase tracking-wide text-white/80 hover:border-tape hover:text-tape"
        >
          {collapsed ? "⟟" : "Close the shop"}
        </button>
      </div>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand room navigation" : "Collapse room navigation"}
        className="h-control-lg border-t border-white/10 text-table text-white/60 hover:text-white"
      >
        {collapsed ? "»" : "« Collapse"}
      </button>
    </nav>
  );
}
