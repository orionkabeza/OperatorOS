"use client";

import * as Checkbox from "@radix-ui/react-checkbox";
import clsx from "clsx";
import { useState } from "react";
import { Button } from "../design/Button";
import { PinInput } from "./PinInput";
import { useAuthStore } from "@/lib/auth-store";
import { getDeviceId } from "@/lib/device-id";
import { USE_MOCK_API } from "@/lib/api/config";

const LOCKOUT_LABEL_FALLBACK = "shortly";

function formatLockoutTime(until: number): string {
  const d = new Date(until);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * D.1 — the Shutter. Every state is real and reachable: idle, submitting,
 * wrong-credentials, locked-out, two-factor. Raise animation is the one
 * showpiece motion (B.7), gated behind prefers-reduced-motion via
 * `motion-safe:`/`motion-reduce:` rather than a JS media-query check, so
 * the fallback is declared once, at the CSS level, and can't drift from
 * the animated version.
 *
 * Login needs a business_slug apps/api has no subdomain-per-tenant
 * routing to source it from yet (docs/DECISIONS.md) -- this remembers
 * the last one used on this device (spec D.1's own "if the subdomain or
 * last-used tenant is known" language) and only asks for it explicitly
 * the first time, or if the remembered one is cleared/wrong.
 */
export function Shutter() {
  const {
    shutterState,
    attemptsRemaining,
    lockedUntil,
    signIn,
    submitTwoFactor,
    signedIn,
    businessSlug,
    setBusinessSlug,
  } = useAuthStore();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const businessName = businessSlug ? titleCaseSlug(businessSlug) : "OperatorOS";

  const submitting = shutterState === "submitting";
  const wrong = shutterState === "wrong-credentials";
  const locked = shutterState === "locked-out";
  const twoFactor = shutterState === "two-factor";

  // `aria-hidden` on its own only hides this from the accessibility tree —
  // it does NOT remove the phone/PIN/checkbox/buttons inside from the tab
  // order, so a sighted keyboard user (or axe's aria-hidden-focus rule)
  // could still reach "invisible" controls once signed in. React 18.3 (this
  // stack's pinned version) doesn't reliably serialize a plain `inert` JSX
  // prop to the DOM — verified empirically, not assumed: it never appeared
  // in the rendered HTML axe inspected. The robust fix that doesn't depend
  // on that is simpler anyway: once signed in, the card's interactive
  // content genuinely doesn't need to stay mounted (it's animating off
  // screen, never coming back for this session), so it's just not rendered.
  return (
    <>
    <div className="shutter-housing" aria-hidden="true" />
    <div
      className={clsx(
        "shutter-slats fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-steel-deep",
        signedIn && "pointer-events-none motion-safe:animate-shutter-raise motion-reduce:animate-shutter-fade",
      )}
      aria-hidden={signedIn}
    >
      <p className="shutter-brand-text type-expanded absolute inset-x-0 top-48 whitespace-nowrap text-center font-display font-bold uppercase tracking-wide text-white/10">
        {businessName}
      </p>

      <div className="relative w-shutter max-w-full mx-16 rounded border-t-4 border-tape bg-paper p-32 shadow-shelf">
        {signedIn ? null : (
          <>
        {submitting ? (
          <div className="absolute inset-x-0 top-0 h-3 overflow-hidden rounded-t bg-rule">
            <div className="motion-safe:animate-count-up h-full w-full bg-tape" />
          </div>
        ) : null}

        {locked ? (
          <div className="flex flex-col gap-16">
            <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">
              OPERATOROS
            </p>
            <p className="text-body text-ink">
              Too many tries. This device is locked until{" "}
              {lockedUntil ? formatLockoutTime(lockedUntil) : LOCKOUT_LABEL_FALLBACK}. If this
              wasn&apos;t you, call your manager.
            </p>
            <Button variant="secondary">Ask for a reset</Button>
          </div>
        ) : twoFactor ? (
          <form
            className="flex flex-col gap-16"
            onSubmit={(e) => {
              e.preventDefault();
              submitTwoFactor(code);
            }}
          >
            <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">
              OPERATOROS
            </p>
            <p className="text-body text-ink">We sent a code to +250 78• ••• •12.</p>
            <PinInput value={code} onChange={setCode} error={wrong} />
            {wrong ? <p className="text-meta text-out">That code didn&apos;t match. Try again.</p> : null}
            <Button type="submit" variant="primary" className="w-full">
              Confirm code
            </Button>
          </form>
        ) : (
          <form
            className="flex flex-col gap-16"
            onSubmit={(e) => {
              e.preventDefault();
              // The "+250" the user sees is a static prefix, not part of
              // `phone`'s own state -- apps/api's identifier match is
              // exact-string against the full E.164-ish number the phone
              // was originally registered with (security/identifiers.py::
              // normalize_phone), so this has to combine them before
              // sending, not rely on the display-only prefix span.
              const fullPhone = USE_MOCK_API ? phone : `+250${phone.replace(/\D/g, "")}`;
              signIn(fullPhone, pin, getDeviceId(), keepSignedIn);
            }}
          >
            <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">
              OPERATOROS
            </p>
            <h1 className="type-expanded font-display text-section-head font-bold text-ink">
              Open up
            </h1>

            {USE_MOCK_API || businessSlug ? null : (
              <div className="flex flex-col gap-4">
                <label
                  htmlFor="shutter-business"
                  className="text-micro font-semibold uppercase tracking-tracked text-ink-soft"
                >
                  Business
                </label>
                <input
                  id="shutter-business"
                  placeholder="your-business-slug"
                  value={businessSlug}
                  onChange={(e) => setBusinessSlug(e.target.value.trim())}
                  className="h-control rounded border border-rule bg-paper px-12 text-body text-ink focus:outline-none focus:border-steel focus:ring-2 focus:ring-tape"
                />
                <p className="text-meta text-ink-soft">Remembered on this device after your first sign-in.</p>
              </div>
            )}

            <div className="flex flex-col gap-4">
              <label
                htmlFor="shutter-phone"
                className="text-micro font-semibold uppercase tracking-tracked text-ink-soft"
              >
                Phone number
              </label>
              <div className="flex gap-8">
                <span className="flex h-control w-control items-center justify-center rounded border border-rule bg-paper text-table text-ink-soft">
                  +250
                </span>
                <input
                  id="shutter-phone"
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={clsx(
                    "h-control flex-1 rounded border bg-paper px-12 text-body text-ink",
                    "focus:outline-none focus:border-steel focus:ring-2 focus:ring-tape",
                    wrong ? "border-out" : "border-rule",
                  )}
                />
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <label className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">
                PIN
              </label>
              <PinInput value={pin} onChange={setPin} error={wrong} disabled={submitting} />
              {wrong ? (
                <p className="text-meta text-out">
                  That PIN doesn&apos;t match this number.
                  {attemptsRemaining === 1
                    ? ` ${attemptsRemaining} try left before this device is locked for 15 minutes.`
                    : ""}
                </p>
              ) : null}
            </div>

            <label className="flex items-start gap-8 text-table text-ink">
              <Checkbox.Root
                checked={keepSignedIn}
                onCheckedChange={(v) => setKeepSignedIn(v === true)}
                className="mt-px h-16 w-16 shrink-0 rounded border border-rule bg-paper data-[state=checked]:bg-tape data-[state=checked]:border-tape-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tape"
              >
                <Checkbox.Indicator className="flex items-center justify-center text-ink">
                  ✓
                </Checkbox.Indicator>
              </Checkbox.Root>
              <span>
                Keep this device signed in for 30 days
                {keepSignedIn ? (
                  <span className="block text-meta text-ink-soft">
                    Only tick this on a device you control.
                  </span>
                ) : null}
              </span>
            </label>

            <Button type="submit" variant="primary" disabled={submitting} className="w-full">
              {submitting ? "Raising…" : "Raise the shutter"}
            </Button>
            <button
              type="button"
              className="self-center text-table text-ink-soft underline underline-offset-2 hover:text-ink"
            >
              I forgot my PIN
            </button>
          </form>
        )}
          </>
        )}
      </div>

      <p className="absolute bottom-32 text-table text-white/40">Kinyarwanda · English · Français</p>
    </div>
    </>
  );
}
