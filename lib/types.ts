export type PayStatus = "paid" | "awaiting" | "unpaid" | "cash";

export type CurrencySymbol = "₵" | "₦" | "KSh" | "USh";

export type NavKey =
  | "today"
  | "orders"
  | "stock"
  | "team"
  | "customers"
  | "catalog"
  | "broadcast"
  | "settings";

/** Shape returned by /api/orders and /api/orders/[id]. */
export interface Order {
  id: string;
  number: number;
  name: string;
  phone: string;
  meta: string;
  total: number;
  items: string;
  pay: PayStatus;
  stage: string;
  aiReplied: boolean;
  ref: string;
  history: string;
  createdAt: string;
}

export interface PayStyle {
  label: string;
  icon: string;
  bg: string;
  fg: string;
  headline: string;
}

export interface DecoratedOrder extends Order {
  totalLabel: string;
  initials: string;
  payLabel: string;
  payIcon: string;
  payBg: string;
  payFg: string;
  rowBg: string;
  showAiReplied: boolean;
}

export interface StubRow {
  a: string;
  b: string;
  c: string;
  tone: string;
}

export interface StubSection {
  title: string;
  sub: string;
  rows: StubRow[];
}

/** Shape returned by /api/stock. */
export interface StockRow {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  lowThreshold: number;
}

/** Shape returned by /api/team. */
export interface TeamRow {
  id: string;
  name: string;
  isAi: boolean;
  active: boolean;
  repliesToday: number;
}

/** Shape returned by /api/customers. */
export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  orderCount: number;
  totalSpend: number;
}

/** Shape returned by /api/catalog. */
export interface ProductRow {
  id: string;
  name: string;
  price: number;
  hidden: boolean;
}

/** Shape returned by /api/broadcasts. */
export interface SegmentRow {
  id: string;
  name: string;
  description: string;
  messages: { status: string; sentAt: string | null }[];
}

/** Shape returned by /api/settings. */
export interface SettingsRow {
  id: number;
  currency: string;
  showAiLabels: boolean;
  whatsappNumber: string | null;
  whatsappConnected: boolean;
  momoConnected: boolean;
  airtelConnected: boolean;
  openingHours: string | null;
  languages: string | null;
}

export interface ActivityRow {
  text: string;
  when: string;
  dot: string;
}

export interface DashboardSummary {
  ordersToday: number;
  stillCooking: number;
  unpaidCount: number;
  unpaidTotal: number;
  lowStockCount: number;
  unansweredCount: number;
  moneyInToday: number;
  activity: ActivityRow[];
}
