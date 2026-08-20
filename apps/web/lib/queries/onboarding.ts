import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getOnboardingState, saveOnboardingState } from "../api/onboarding";
import type { OnboardingState } from "../api/types";

export const ONBOARDING_QUERY_KEY = ["onboarding-state"] as const;

export function useOnboardingState() {
  return useQuery({ queryKey: ONBOARDING_QUERY_KEY, queryFn: getOnboardingState });
}

export function useSaveOnboardingState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (state: OnboardingState) => saveOnboardingState(state),
    onSuccess: (state) => {
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, state);
    },
  });
}
