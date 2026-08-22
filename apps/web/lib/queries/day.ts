import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closeDay, getDayCloseChecklist, getDaySummary, getDayStatus, openDay, reopenDay } from "../api/day";
import { useAuthStore } from "../auth-store";
import type { OpenDayInput, VarianceReason } from "../api/types";
import type { MinorUnits } from "@operatoros/shared";

export const DAY_STATUS_KEY = ["day-status"] as const;

export function useDayStatus() {
  // Gated on sign-in because app/page.tsx now reads day status to decide
  // which screen a tenant belongs on, and that runs before the Shutter is
  // cleared. Every real day call resolves a location from `GET /users/me`
  // first, so firing it signed-out is a guaranteed 401 -- which, now that
  // failures surface globally (lib/query-client.ts), would land as an error
  // toast on the login screen itself.
  const signedIn = useAuthStore((s) => s.signedIn);
  return useQuery({ queryKey: DAY_STATUS_KEY, queryFn: getDayStatus, enabled: signedIn });
}

export function useOpenDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenDayInput) => openDay(input),
    onSuccess: (session) => {
      queryClient.setQueryData(DAY_STATUS_KEY, session);
    },
  });
}

export function useCloseDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { countedMinor: MinorUnits; reason?: VarianceReason | undefined; reasonNote?: string | undefined }) => closeDay(input),
    onSuccess: (session) => {
      queryClient.setQueryData(DAY_STATUS_KEY, session);
    },
  });
}

export function useReopenDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => reopenDay(),
    onSuccess: (session) => {
      queryClient.setQueryData(DAY_STATUS_KEY, session);
    },
  });
}

export function useDayCloseChecklist() {
  return useQuery({ queryKey: ["day-close-checklist"], queryFn: getDayCloseChecklist });
}

export function useDaySummary(enabled: boolean) {
  return useQuery({ queryKey: ["day-summary"], queryFn: getDaySummary, enabled });
}
