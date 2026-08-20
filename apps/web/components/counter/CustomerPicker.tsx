"use client";

import { useState } from "react";
import { Button } from "../design/Button";
import { Input } from "../design/Input";
import { Money } from "../design/Money";
import { useCreateCustomer, useCustomers } from "@/lib/queries/customers";

/** D.4 basket footer customer selector: search by name/phone, shows outstanding balance inline, inline quick-add. */
export function CustomerPicker({
  customerId,
  onSelect,
}: {
  customerId: string | null;
  onSelect: (customerId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const { data: customers } = useCustomers(search);
  const { data: selectedList } = useCustomers();
  const createCustomer = useCreateCustomer();

  const selected = selectedList?.find((c) => c.id === customerId);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-control w-full items-center justify-between rounded border border-rule bg-paper px-12 text-body text-ink"
      >
        <span>{selected ? selected.name : "Walk-in"}</span>
        {selected && selected.balanceMinor > 0 ? <Money amount={selected.balanceMinor} emphasis="out" /> : null}
      </button>
    );
  }

  return (
    <div className="rounded border border-rule bg-paper p-12">
      <div className="flex items-center justify-between">
        <input
          autoFocus
          aria-label="Search customers by name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="h-control flex-1 rounded border border-rule bg-paper px-8 text-body text-ink"
        />
        <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>

      <ul className="mt-8 flex max-h-96 flex-col gap-4 overflow-y-auto">
        <li>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between rounded px-8 py-4 text-left text-body text-ink hover:bg-floor"
          >
            Walk-in
          </button>
        </li>
        {(customers ?? []).map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => {
                onSelect(c.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded px-8 py-4 text-left text-body text-ink hover:bg-floor"
            >
              <span>
                {c.name} <span className="text-meta text-ink-soft">{c.phone}</span>
              </span>
              {c.balanceMinor > 0 ? <Money amount={c.balanceMinor} emphasis="out" /> : null}
            </button>
          </li>
        ))}
      </ul>

      {creating ? (
        <div className="mt-8 flex flex-col gap-8 border-t border-rule pt-8">
          <Input label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Input label="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          <Button
            variant="primary"
            type="button"
            disabled={!newName.trim() || !newPhone.trim()}
            onClick={async () => {
              const customer = await createCustomer.mutateAsync({ name: newName.trim(), phone: newPhone.trim() });
              onSelect(customer.id);
              setCreating(false);
              setOpen(false);
              setNewName("");
              setNewPhone("");
            }}
          >
            Add customer
          </Button>
        </div>
      ) : (
        <Button variant="ghost" type="button" onClick={() => setCreating(true)} className="mt-8">
          + New customer
        </Button>
      )}
    </div>
  );
}
