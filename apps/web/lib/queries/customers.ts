import type { MinorUnits } from "@operatoros/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCustomer, getCustomer, listCustomers, updateCustomerCreditLimit, updateCustomerHold } from "../api/customers";
import type { CreateCustomerInput } from "../api/types";

export function useCustomers(search?: string) {
  return useQuery({ queryKey: ["customers", search ?? ""], queryFn: () => listCustomers(search) });
}

export function useCustomer(id: string | null) {
  return useQuery({ queryKey: ["customer", id], queryFn: () => getCustomer(id as string), enabled: Boolean(id) });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) => createCustomer(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

function invalidateCustomerQueries(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  void queryClient.invalidateQueries({ queryKey: ["customers"] });
  void queryClient.invalidateQueries({ queryKey: ["customer", id] });
  void queryClient.invalidateQueries({ queryKey: ["debt-accounts"] });
  void queryClient.invalidateQueries({ queryKey: ["debt-header"] });
}

export function useSetCustomerHold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; onHold: boolean }) => updateCustomerHold(args.id, args.onHold),
    onSuccess: (_r, args) => invalidateCustomerQueries(queryClient, args.id),
  });
}

export function useSetCustomerCreditLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; creditLimitMinor: MinorUnits }) => updateCustomerCreditLimit(args.id, args.creditLimitMinor),
    onSuccess: (_r, args) => invalidateCustomerQueries(queryClient, args.id),
  });
}
