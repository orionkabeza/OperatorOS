import * as Checkbox from "@radix-ui/react-checkbox";
import { Button } from "../design/Button";
import { Input } from "../design/Input";
import type { OnboardingPaymentMethods } from "@/lib/api/types";

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-8 rounded border border-rule bg-paper px-16 py-12 text-body text-ink">
      <Checkbox.Root
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="h-16 w-16 shrink-0 rounded border border-rule bg-paper data-[state=checked]:border-tape-deep data-[state=checked]:bg-tape focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tape"
      >
        <Checkbox.Indicator className="flex items-center justify-center text-ink">✓</Checkbox.Indicator>
      </Checkbox.Root>
      {label}
    </label>
  );
}

/** D.2 Step 2 — payment methods, with graceful "Connect later" degrade per phase-1 plan §0.6. */
export function StepCounter({
  value,
  onChange,
}: {
  value: Partial<OnboardingPaymentMethods>;
  onChange: (next: Partial<OnboardingPaymentMethods>) => void;
}) {
  return (
    <div className="flex flex-col gap-16">
      <p className="text-body text-ink-soft">Which of these do you take?</p>
      <div className="grid grid-cols-2 gap-8">
        <Toggle label="Cash" checked={value.cash ?? true} onChange={(cash) => onChange({ cash })} />
        <Toggle label="Bank transfer" checked={value.bank ?? false} onChange={(bank) => onChange({ bank })} />
        <Toggle label="Card" checked={value.card ?? false} onChange={(card) => onChange({ card })} />
        <Toggle label="Cheque" checked={value.cheque ?? false} onChange={(cheque) => onChange({ cheque })} />
        <Toggle
          label="Credit (sell now, pay later)"
          checked={value.credit ?? true}
          onChange={(credit) => onChange({ credit })}
        />
      </div>

      {(["momo", "airtel"] as const).map((key) => {
        const cfg = value[key] ?? { enabled: false, merchantCode: "", connected: false };
        const label = key === "momo" ? "MTN MoMo" : "Airtel Money";
        return (
          <div key={key} className="rounded border border-rule bg-paper p-16">
            <Toggle label={label} checked={cfg.enabled} onChange={(enabled) => onChange({ [key]: { ...cfg, enabled } })} />
            {cfg.enabled ? (
              <div className="mt-12 flex flex-wrap items-end gap-8">
                <Input
                  label="Merchant / paybill code"
                  value={cfg.merchantCode}
                  onChange={(e) => onChange({ [key]: { ...cfg, merchantCode: e.target.value } })}
                />
                <Button
                  variant={cfg.connected ? "secondary" : "primary"}
                  onClick={() => onChange({ [key]: { ...cfg, connected: !cfg.connected } })}
                >
                  {cfg.connected ? "Connected" : "Connect now"}
                </Button>
                {!cfg.connected ? (
                  <p className="w-full text-meta text-ink-soft">
                    Connect later — manual entry works until you do. No mobile-money API is live yet (Phase 2).
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
