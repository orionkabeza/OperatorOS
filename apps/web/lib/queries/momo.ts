import type { MinorUnits } from "@operatoros/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getUnmatchedMomoTotal, listMomoTransactions, markMomoAsCash, matchMomoTransaction, requestMomoPayment, voidMomoTransaction } from "../api/momo";

export function useMomoTransactions() {
  return useQuery({ queryKey: ["momo-transactions"], queryFn: listMomoTransactions });
}

export function useUnmatchedMomoTotal() {
  return useQuery({ queryKey: ["momo-unmatched-total"], queryFn: getUnmatchedMomoTotal });
}

function invalidateMomoQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["momo-transactions"] });
  void queryClient.invalidateQueries({ queryKey: ["momo-unmatched-total"] });
  void queryClient.invalidateQueries({ queryKey: ["money-locations"] });
  void queryClient.invalidateQueries({ queryKey: ["money-movements"] });
  void queryClient.invalidateQueries({ queryKey: ["debt-header"] });
  void queryClient.invalidateQueries({ queryKey: ["debt-accounts"] });
  void queryClient.invalidateQueries({ queryKey: ["customers"] });
}

export function useMatchMomoTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { momoTransactionId: string; customerId: string }) => matchMomoTransaction(args),
    onSuccess: () => invalidateMomoQueries(queryClient),
  });
}

export function useMarkMomoAsCash() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (momoTransactionId: string) => markMomoAsCash(momoTransactionId),
    onSuccess: () => invalidateMomoQueries(queryClient),
  });
}

export function useVoidMomoTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (momoTransactionId: string) => voidMomoTransaction(momoTransactionId),
    onSuccess: () => invalidateMomoQueries(queryClient),
  });
}

export function useRequestMomoPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { customerId: string; amountMinor: MinorUnits; phone: string }) => requestMomoPayment(args.customerId, args.amountMinor, args.phone),
    onSuccess: () => invalidateMomoQueries(queryClient),
  });
}
