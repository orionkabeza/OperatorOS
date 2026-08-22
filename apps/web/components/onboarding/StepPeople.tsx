"use client";

import { useState } from "react";
import { Button } from "../design/Button";
import { Input } from "../design/Input";
import { KeptOnThisDevice } from "./KeptOnThisDevice";
import { Select } from "./Select";
import type { OnboardingStaffInvite } from "@/lib/api/types";

const ROLES: { value: OnboardingStaffInvite["role"]; label: string }[] = [
  { value: "manager", label: "Manager" },
  { value: "cashier", label: "Cashier" },
  { value: "stock_clerk", label: "Stock clerk" },
];

/** D.2 Step 4 — invite staff by phone with a role; each gets a WhatsApp invite (stub — see D.4/D.12 notification seam). Skippable. */
export function StepPeople({
  staff,
  onChange,
}: {
  staff: OnboardingStaffInvite[];
  onChange: (staff: OnboardingStaffInvite[]) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<OnboardingStaffInvite["role"]>("cashier");

  function addStaff() {
    if (!name.trim() || !phone.trim()) return;
    onChange([...staff, { name: name.trim(), phone: phone.trim(), role }]);
    setName("");
    setPhone("");
  }

  return (
    <div className="flex flex-col gap-16">
      <p className="text-body text-ink-soft">
        Note down who works here, so the list is ready when you set them up. You can skip this and add people later.
      </p>
      <KeptOnThisDevice>
        No account is created and no invite is sent yet — nobody here can sign in until staff accounts land.
      </KeptOnThisDevice>

      <div className="flex flex-wrap items-end gap-8">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+250 7…" />
        <Select label="Role" value={role} onChange={(v) => setRole(v as OnboardingStaffInvite["role"])} options={ROLES} />
        <Button variant="secondary" type="button" onClick={addStaff}>
          Add
        </Button>
      </div>

      {staff.length > 0 ? (
        <ul className="flex flex-col gap-8">
          {staff.map((s, i) => (
            <li
              key={`${s.phone}-${i}`}
              className="flex items-center justify-between rounded border border-rule bg-paper px-16 py-8"
            >
              <span className="text-body text-ink">
                {s.name} · {s.phone} ·{" "}
                <span className="text-ink-soft">{ROLES.find((r) => r.value === s.role)?.label}</span>
              </span>
              <Button variant="ghost" type="button" onClick={() => onChange(staff.filter((_, idx) => idx !== i))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-ink-soft">No one added yet.</p>
      )}
    </div>
  );
}
