import type { MinorUnits } from "@operatoros/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listMoneyLocations, listMoneyMovements, updateMoneyLocationBalance } from "../api/cashbox";
import type { MoneyMovementFilters } from "../api/types";

export function useMoneyLocations() {
  return useQuery({ queryKey: ["money-locations"], queryFn: listMoneyLocations });
}

export function useMoneyMovements(filters?: MoneyMovementFilters) {
  return useQuery({ queryKey: ["money-movements", filters ?? {}], queryFn: () => listMoneyMovements(filters) });
}

export function useUpdateMoneyLocationBalance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { accountKey: string; countedMinor: MinorUnits; reason?: string }) =>
      updateMoneyLocationBalance(args.accountKey, args.countedMinor, args.reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["money-locations"] });
      void queryClient.invalidateQueries({ queryKey: ["money-movements"] });
    },
  });
}
