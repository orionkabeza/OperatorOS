import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closeDay, getDayCloseChecklist, getDaySummary, getDayStatus, openDay, reopenDay } from "../api/day";
import type { OpenDayInput, VarianceReason } from "../api/types";
import type { MinorUnits } from "@operatoros/shared";

export const DAY_STATUS_KEY = ["day-status"] as const;

export function useDayStatus() {
  return useQuery({ queryKey: DAY_STATUS_KEY, queryFn: getDayStatus });
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
    mutationFn: (input: { countedMinor: MinorUnits; reason?: VarianceReason; reasonNote?: string }) => closeDay(input),
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
