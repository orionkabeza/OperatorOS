import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { approveExpense, createRecurringExpense, listExpenses, listRecurringExpenses, recordExpense, rejectExpense, toggleRecurringExpense } from "../api/expenses";
import type { RecordExpenseInput } from "../api/types";

export function useExpenses() {
  return useQuery({ queryKey: ["expenses"], queryFn: listExpenses });
}

function invalidateExpenseQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["expenses"] });
  void queryClient.invalidateQueries({ queryKey: ["money-locations"] });
  void queryClient.invalidateQueries({ queryKey: ["money-movements"] });
}

export function useRecordExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordExpenseInput) => recordExpense(input),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

export function useApproveExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveExpense(id),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

export function useRejectExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; note?: string }) => rejectExpense(args.id, args.note),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

export function useRecurringExpenses() {
  return useQuery({ queryKey: ["recurring-expenses"], queryFn: listRecurringExpenses });
}

export function useCreateRecurringExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { template: RecordExpenseInput; interval: "weekly" | "monthly" }) => createRecurringExpense(args.template, args.interval),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["recurring-expenses"] }),
  });
}

export function useToggleRecurringExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; active: boolean }) => toggleRecurringExpense(args.id, args.active),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["recurring-expenses"] }),
  });
}
