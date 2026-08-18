import type { NavKey } from "@/lib/types";

interface NavItem {
  key: NavKey;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "today", label: "Today", icon: "◉" },
  { key: "orders", label: "Orders & payments", icon: "▤" },
  { key: "stock", label: "Stock", icon: "▦" },
  { key: "team", label: "Team", icon: "◍" },
  { key: "customers", label: "Customers", icon: "☺" },
  { key: "catalog", label: "Catalog", icon: "▧" },
  { key: "broadcast", label: "Broadcast", icon: "➤" },
  { key: "settings", label: "Settings", icon: "⚙" },
];

interface SidebarProps {
  tab: NavKey;
  onNavigate: (tab: NavKey) => void;
  moneyIn: string;
  ordersBadge: number;
  stockBadge: number;
  whatsappConnected: boolean;
}

export default function Sidebar({ tab, onNavigate, moneyIn, ordersBadge, stockBadge, whatsappConnected }: SidebarProps) {
  const badgeFor = (key: NavKey): string | undefined => {
    if (key === "orders" && ordersBadge > 0) return String(ordersBadge);
    if (key === "stock" && stockBadge > 0) return String(stockBadge);
    return undefined;
  };
  return (
    <div
      style={{
        borderRight: "1px solid oklch(0.91 0.008 120)",
        background: "oklch(0.99 0.004 95)",
        padding: "22px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 6px" }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: "oklch(0.52 0.11 155)",
            color: "oklch(0.99 0.01 155)",
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: 15,
            flex: "none",
          }}
        >
          AE
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 650,
              letterSpacing: "-0.015em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Auntie Efua&apos;s Kitchen
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "oklch(0.57 0.01 150)",
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginTop: 2,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: whatsappConnected ? "oklch(0.52 0.11 155)" : "oklch(0.6 0.01 150)",
                animation: whatsappConnected ? "pulseDot 2.4s ease-in-out infinite" : "none",
              }}
            />
            {whatsappConnected ? "WhatsApp connected" : "WhatsApp not connected"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV_ITEMS.map((n) => {
          const active = tab === n.key;
          return (
            <button
              key={n.key}
              className="nav-btn"
              onClick={() => onNavigate(n.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 12,
                background: active ? "oklch(0.95 0.03 155)" : "transparent",
                color: active ? "oklch(0.38 0.1 155)" : "oklch(0.42 0.012 150)",
                fontSize: 14.5,
                fontWeight: active ? 650 : 550,
              }}
            >
              <span style={{ width: 18, textAlign: "center", fontSize: 15 }}>{n.icon}</span>
              <span style={{ flex: 1 }}>{n.label}</span>
              {badgeFor(n.key) ? (
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    padding: "2px 7px",
                    borderRadius: 6,
                    background: "oklch(0.95 0.04 70)",
                    color: "oklch(0.45 0.09 60)",
                  }}
                >
                  {badgeFor(n.key)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        style={{
          marginTop: "auto",
          border: "1px solid oklch(0.91 0.008 120)",
          borderRadius: 16,
          padding: 14,
        }}
      >
        <div style={{ fontSize: 12.5, color: "oklch(0.56 0.01 150)" }}>Money in today</div>
        <div
          className="mono"
          style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.03em", marginTop: 4 }}
        >
          {moneyIn}
        </div>
        <div style={{ fontSize: 12, color: "oklch(0.5 0.09 155)", marginTop: 3 }}>Confirmed payments</div>
      </div>

      <button
        onClick={async () => {
          try {
            await fetch("/api/auth/logout", { method: "POST" });
          } catch {
            // Navigate to /login regardless; the cookie is httpOnly so the
            // server clears it, and /login is the right place to land.
          }
          window.location.href = "/login";
        }}
        className="ghost-btn"
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: "oklch(0.55 0.01 150)",
          padding: "8px 12px",
          borderRadius: 10,
          textAlign: "center",
        }}
      >
        Log out
      </button>
    </div>
  );
}
