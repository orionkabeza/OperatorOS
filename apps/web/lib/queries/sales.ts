import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  issueQuote,
  listParkedSales,
  listQuotes,
  listTodaysSales,
  parkSale,
  recordReturn,
  recordSale,
  resumeParkedSale,
  undoSale,
} from "../api/sales";
import type { BasketLineInput, RecordReturnInput, RecordSaleInput } from "../api/types";
import type { MinorUnits } from "@operatoros/shared";

export function useTodaysSales() {
  return useQuery({ queryKey: ["sales", "today"], queryFn: listTodaysSales });
}

export function useRecordSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordSaleInput) => recordSale(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["day-status"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useUndoSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (saleId: string) => undoSale(saleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useParkedSales() {
  return useQuery({ queryKey: ["parked-sales"], queryFn: listParkedSales });
}

export function useParkSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { label: string; lines: BasketLineInput[]; customerId: string | null }) =>
      parkSale(args.label, args.lines, args.customerId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["parked-sales"] }),
  });
}

export function useResumeParkedSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resumeParkedSale(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["parked-sales"] }),
  });
}

export function useQuotes() {
  return useQuery({ queryKey: ["quotes"], queryFn: listQuotes });
}

export function useIssueQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { lines: BasketLineInput[]; customerId: string | null; totalMinor: MinorUnits }) =>
      issueQuote(args.lines, args.customerId, args.totalMinor),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quotes"] }),
  });
}

export function useRecordReturn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordReturnInput) => recordReturn(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
    },
  });
}
