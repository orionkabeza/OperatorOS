import type { TallyKey } from "./tally-store";

export interface Room {
  id: string;
  label: string;
  tallyKey?: TallyKey;
}

/** C.1 — the seven rooms, in spec order, plus Close the Shop at the bottom of the rail. */
export const ROOMS: Room[] = [
  { id: "counter", label: "Counter", tallyKey: "taken" },
  { id: "stock-room", label: "Stock Room", tallyKey: "stock" },
  { id: "debt-book", label: "Debt Book", tallyKey: "credit" },
  { id: "cash-box", label: "Cash Box", tallyKey: "till" },
  { id: "suppliers", label: "Suppliers" },
  { id: "team", label: "Team" },
  { id: "back-office", label: "Back Office" },
];
