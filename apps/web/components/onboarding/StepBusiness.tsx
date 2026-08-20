import { Input } from "../design/Input";
import { Select } from "./Select";
import type { BusinessType, OnboardingBusiness } from "@/lib/api/types";

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: "retail_shop", label: "Retail shop" },
  { value: "hardware_store", label: "Hardware store" },
  { value: "wholesaler", label: "Wholesaler" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "agro_dealer", label: "Agro-dealer" },
  { value: "auto_parts", label: "Auto parts" },
  { value: "building_supplies", label: "Building supplies" },
  { value: "other", label: "Other" },
];

/** D.2 Step 1 — the only non-skippable step. */
export function StepBusiness({
  value,
  onChange,
}: {
  value: Partial<OnboardingBusiness>;
  onChange: (next: Partial<OnboardingBusiness>) => void;
}) {
  return (
    <div className="flex flex-col gap-16">
      <p className="text-body text-ink-soft">Tell us about the business — this is the one step you can&apos;t skip.</p>
      <Input
        label="Trading name"
        value={value.tradingName ?? ""}
        onChange={(e) => onChange({ tradingName: e.target.value })}
        required
      />
      <Input
        label="Legal name (if different)"
        value={value.legalName ?? ""}
        onChange={(e) => onChange({ legalName: e.target.value })}
      />
      <Select
        label="Business type"
        value={value.businessType ?? ""}
        onChange={(v) => onChange({ businessType: v as BusinessType })}
        options={BUSINESS_TYPES}
        placeholder="Choose one"
      />
      <Input
        label="TIN (optional now, required before EBM invoicing)"
        value={value.tin ?? ""}
        onChange={(e) => onChange({ tin: e.target.value })}
      />
      <Input
        label="Physical address"
        value={value.address ?? ""}
        onChange={(e) => onChange({ address: e.target.value })}
      />
      <Input
        label="Primary phone"
        value={value.phone ?? ""}
        onChange={(e) => onChange({ phone: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-16">
        <Input label="Currency" value="RWF" disabled />
        <Input
          label="Financial year start (MM-DD)"
          placeholder="01-01"
          value={value.financialYearStart ?? ""}
          onChange={(e) => onChange({ financialYearStart: e.target.value })}
        />
      </div>
    </div>
  );
}

export function isStepBusinessValid(value: Partial<OnboardingBusiness>): boolean {
  return Boolean(value.tradingName && value.tradingName.trim().length > 0 && value.businessType);
}
