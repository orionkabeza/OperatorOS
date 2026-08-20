"use client";

import { useEffect, useState } from "react";
import { Button } from "../design/Button";
import { OpenShopModal } from "../day/OpenShopModal";
import { Shelf } from "./Shelf";
import { StepBooks } from "./StepBooks";
import { StepBusiness, isStepBusinessValid } from "./StepBusiness";
import { StepComplete } from "./StepComplete";
import { StepCounter } from "./StepCounter";
import { StepPeople } from "./StepPeople";
import { StepStock } from "./StepStock";
import { useDayStatus } from "@/lib/queries/day";
import { useOnboardingState, useSaveOnboardingState } from "@/lib/queries/onboarding";
import { EMPTY_ONBOARDING_STATE } from "@/lib/api/onboarding";
import type { OnboardingState } from "@/lib/api/types";

/**
 * D.2 — "Fitting out the shop." Every step but the first is skippable; the
 * shelf shows real progress, not a percentage bar. State is persisted (see
 * lib/api/onboarding.ts) after every step change so it resumes if the
 * tenant navigates away mid-setup, per the spec's "resumes on any device"
 * requirement (mock: same-browser only, clearly marked there).
 */
export function Onboarding({ onFinish }: { onFinish: () => void }) {
  const { data: loaded, isLoading } = useOnboardingState();
  const save = useSaveOnboardingState();
  const { data: day } = useDayStatus();
  const [state, setState] = useState<OnboardingState>(EMPTY_ONBOARDING_STATE);
  const [showOpenShop, setShowOpenShop] = useState(false);

  useEffect(() => {
    if (loaded) setState(loaded);
  }, [loaded]);

  useEffect(() => {
    if (day?.status === "open" && showOpenShop) {
      setShowOpenShop(false);
      const finished = { ...state, completed: true };
      setState(finished);
      void save.mutateAsync(finished).then(onFinish);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day?.status]);

  function persist(next: OnboardingState) {
    setState(next);
    void save.mutate(next);
  }

  function goToStep(step: OnboardingState["step"]) {
    persist({ ...state, step });
  }

  if (isLoading) {
    return <p className="p-32 text-body text-ink-soft">Loading…</p>;
  }

  const canAdvanceFromStep1 = isStepBusinessValid(state.business);

  return (
    <div className="mx-auto flex min-h-screen max-w-form flex-col gap-24 p-16 md:p-32">
      <div>
        <p className="text-micro font-semibold uppercase tracking-tracked text-ink-soft">OPERATOROS</p>
        <h1 className="type-expanded font-display text-screen-title font-bold text-ink">Fitting out the shop</h1>
      </div>

      {state.step <= 5 ? <Shelf currentStep={state.step} /> : null}

      <div className="rounded border border-rule bg-paper p-24 shadow-shelf">
        {state.step === 1 ? (
          <StepBusiness value={state.business} onChange={(business) => persist({ ...state, business: { ...state.business, ...business } })} />
        ) : null}
        {state.step === 2 ? (
          <StepCounter
            value={state.paymentMethods}
            onChange={(paymentMethods) => persist({ ...state, paymentMethods: { ...state.paymentMethods, ...paymentMethods } })}
          />
        ) : null}
        {state.step === 3 ? (
          <StepStock
            path={state.stockPath}
            productsAdded={state.productsAdded}
            onSelectPath={(stockPath) => persist({ ...state, stockPath })}
            onProductsAdded={(count) => persist({ ...state, productsAdded: state.productsAdded + count })}
          />
        ) : null}
        {state.step === 4 ? <StepPeople staff={state.staff} onChange={(staff) => persist({ ...state, staff })} /> : null}
        {state.step === 5 ? (
          <StepBooks
            value={state.openingBalances}
            onChange={(openingBalances) => persist({ ...state, openingBalances: { ...state.openingBalances, ...openingBalances } })}
          />
        ) : null}
        {state.step === 6 ? <StepComplete state={state} onOpenShop={() => setShowOpenShop(true)} /> : null}
      </div>

      {state.step <= 5 ? (
        <div className="flex items-center justify-between">
          <Button variant="ghost" type="button" disabled={state.step === 1} onClick={() => goToStep((state.step - 1) as OnboardingState["step"])}>
            Back
          </Button>
          <div className="flex items-center gap-8">
            {state.step > 1 ? (
              <Button variant="ghost" type="button" onClick={() => goToStep((state.step + 1) as OnboardingState["step"])}>
                Skip this step
              </Button>
            ) : null}
            <Button
              variant="primary"
              type="button"
              disabled={state.step === 1 && !canAdvanceFromStep1}
              disabledReason={state.step === 1 && !canAdvanceFromStep1 ? "Trading name and business type are required." : undefined}
              onClick={() => goToStep((state.step + 1) as OnboardingState["step"])}
            >
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      <OpenShopModal open={showOpenShop} onDeferred={() => setShowOpenShop(false)} />
    </div>
  );
}
