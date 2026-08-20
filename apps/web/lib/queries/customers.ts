import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCustomer, getCustomer, listCustomers } from "../api/customers";
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
