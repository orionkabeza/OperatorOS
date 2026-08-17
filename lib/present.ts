import { GOOD_TONE, LOW_TONE, MUTED_TONE, NORMAL_TONE, WARN_TONE } from "./data";
import type {
  CustomerRow,
  ProductRow,
  SegmentRow,
  SettingsRow,
  StockRow,
  StubRow,
  StubSection,
  TeamRow,
} from "./types";

export function stockToRows(stock: StockRow[]): StubRow[] {
  return stock.map((s) => {
    const low = s.quantity < s.lowThreshold;
    return {
      a: s.name,
      b: low ? "Low — reorder today" : "In stock",
      c: `${s.quantity} left`,
      tone: low ? LOW_TONE : NORMAL_TONE,
    };
  });
}

export function lowStockRows(stock: StockRow[]): StubRow[] {
  return stockToRows(stock).filter((r) => r.tone !== NORMAL_TONE);
}

export function teamToRows(team: TeamRow[]): StubRow[] {
  return team.map((m) => ({
    a: m.name,
    b: !m.active ? "Off today" : `Replied to ${m.repliesToday} message${m.repliesToday === 1 ? "" : "s"}`,
    c: m.isAi ? "instant" : !m.active ? "—" : `${m.repliesToday} today`,
    tone: m.isAi ? GOOD_TONE : !m.active ? MUTED_TONE : NORMAL_TONE,
  }));
}

export function customersToRows(customers: CustomerRow[], cur: (n: number) => string): StubRow[] {
  return customers.map((c) => ({
    a: c.name,
    b: `${c.orderCount} order${c.orderCount === 1 ? "" : "s"}`,
    c: cur(c.totalSpend),
    tone: c.orderCount === 0 ? WARN_TONE : NORMAL_TONE,
  }));
}

export function catalogToRows(products: ProductRow[], cur: (n: number) => string): StubRow[] {
  return products.map((p) => ({
    a: p.name,
    b: p.hidden ? "Hidden" : "Shown in WhatsApp",
    c: cur(p.price),
    tone: p.hidden ? MUTED_TONE : NORMAL_TONE,
  }));
}

export function broadcastsToRows(segments: SegmentRow[]): StubRow[] {
  return segments.map((s) => {
    const latest = s.messages[0];
    return {
      a: s.name,
      b: s.description,
      c: latest ? latest.status : "—",
      tone: latest ? GOOD_TONE : MUTED_TONE,
    };
  });
}

export function settingsToRows(settings: SettingsRow): StubRow[] {
  return [
    {
      a: "WhatsApp Business number",
      b: settings.whatsappNumber ?? "Not set",
      c: settings.whatsappConnected ? "connected" : "set up",
      tone: settings.whatsappConnected ? GOOD_TONE : WARN_TONE,
    },
    {
      a: "MTN Mobile Money",
      b: "Auto-confirms payments",
      c: settings.momoConnected ? "connected" : "set up",
      tone: settings.momoConnected ? GOOD_TONE : WARN_TONE,
    },
    {
      a: "Airtel Money",
      b: settings.airtelConnected ? "Auto-confirms payments" : "Not connected yet",
      c: settings.airtelConnected ? "connected" : "set up",
      tone: settings.airtelConnected ? GOOD_TONE : WARN_TONE,
    },
    {
      a: "Opening hours",
      b: settings.openingHours ?? "Not set",
      c: "edit",
      tone: MUTED_TONE,
    },
    {
      a: "Languages",
      b: settings.languages ?? "Not set",
      c: "edit",
      tone: MUTED_TONE,
    },
  ];
}

export function buildStubSection(
  tab: string,
  data: {
    stock: StockRow[];
    team: TeamRow[];
    customers: CustomerRow[];
    products: ProductRow[];
    segments: SegmentRow[];
    settings: SettingsRow | null;
  },
  cur: (n: number) => string
): StubSection | null {
  switch (tab) {
    case "stock":
      return {
        title: "Stock",
        sub: "Counts drop by themselves when an order is delivered",
        rows: stockToRows(data.stock),
      };
    case "team":
      return {
        title: "Team activity",
        sub: "Just who replied and how quickly — nothing graded",
        rows: teamToRows(data.team),
      };
    case "customers":
      return {
        title: "Customers",
        sub: "Order history and simple tags",
        rows: customersToRows(data.customers, cur),
      };
    case "catalog":
      return {
        title: "Catalog",
        sub: "What customers can see and order in WhatsApp",
        rows: catalogToRows(data.products, cur),
      };
    case "broadcast":
      return {
        title: "Broadcast",
        sub: "Message a group of customers at once",
        rows: broadcastsToRows(data.segments),
      };
    case "settings":
      return data.settings
        ? {
            title: "Settings",
            sub: "Connections, hours and languages",
            rows: settingsToRows(data.settings),
          }
        : null;
    default:
      return null;
  }
}
