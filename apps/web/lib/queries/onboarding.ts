import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getOnboardingState, saveOnboardingState } from "../api/onboarding";
import { useAuthStore } from "../auth-store";
import { useDayStatus } from "./day";
import type { OnboardingState } from "../api/types";

/** Keyed by business for the same reason the storage is (lib/api/onboarding.ts):
 *  the cache outlives a sign-out, and one tenant's wizard must not answer for
 *  another's. */
export function onboardingQueryKey(businessSlug: string) {
  return ["onboarding-state", businessSlug] as const;
}

function useBusinessSlug() {
  return useAuthStore((s) => s.businessSlug || s.rememberedSlug);
}

export function useOnboardingState() {
  const businessSlug = useBusinessSlug();
  return useQuery({ queryKey: onboardingQueryKey(businessSlug), queryFn: getOnboardingState });
}

export function useSaveOnboardingState() {
  const queryClient = useQueryClient();
  const businessSlug = useBusinessSlug();
  return useMutation({
    mutationFn: (state: OnboardingState) => saveOnboardingState(state),
    onSuccess: (state) => {
      queryClient.setQueryData(onboardingQueryKey(businessSlug), state);
    },
  });
}

/**
 * Which of the two top-level screens a signed-in tenant belongs on.
 *
 * The wizard's "completed" flag lives in this browser -- there is no
 * onboarding endpoint to put it behind (see lib/api/onboarding.ts) -- but
 * the thing it gates on, the shop being open, lives on the server. Nothing
 * reconciled the two, and when they disagreed the app locked the tenant
 * out of it entirely: a browser that had lost its flag put a fitted-out
 * shop back at step 1 of setup, and the wizard's one exit, "Open the shop,"
 * is a day-open the API refuses for a day that is already open --
 * 409 "The shop is already open at this location." Every route forward was
 * closed, and "Not yet" only returned to the same screen.
 *
 * Server truth decides. Opening the day is the last action of the wizard,
 * so an open day is proof the shop is fitted out no matter what this
 * browser remembers. The flag is written back rather than merely inferred,
 * so it is still true tonight once the day is closed again.
 */
export function useOnboardingGate(): { decided: boolean; fittedOut: boolean } {
  const { data: onboarding } = useOnboardingState();
  const { data: day, isLoading: dayLoading } = useDayStatus();
  const save = useSaveOnboardingState();
  const dayIsOpen = day?.status === "open";
  const writtenBack = useRef(false);

  useEffect(() => {
    if (!dayIsOpen || !onboarding || onboarding.completed || writtenBack.current) return;
    writtenBack.current = true;
    save.mutate({ ...onboarding, completed: true });
  }, [dayIsOpen, onboarding, save]);

  return {
    // Deciding before the day status is in would flash the setup wizard at
    // every tenant who already has a shop, on every page load.
    decided: Boolean(onboarding) && !dayLoading,
    fittedOut: Boolean(onboarding?.completed) || dayIsOpen,
  };
}
