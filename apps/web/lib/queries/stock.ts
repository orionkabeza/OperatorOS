import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adjustStock,
  countStocktakeLine,
  createTransfer,
  listStockMovements,
  listStocktakes,
  listTransfers,
  moveStocktakeToReview,
  postStocktake,
  receiveTransfer,
  startStocktake,
} from "../api/stock";
import type { AdjustStockInput, StockMovementFilters, StocktakeScope } from "../api/types";

export function useStockMovements(filters?: StockMovementFilters) {
  return useQuery({ queryKey: ["stock-movements", filters ?? {}], queryFn: () => listStockMovements(filters) });
}

export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdjustStockInput) => adjustStock(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    },
  });
}

export function useStocktakes() {
  return useQuery({ queryKey: ["stocktakes"], queryFn: listStocktakes });
}

export function useStartStocktake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { scope: StocktakeScope; freezeItems: boolean }) => startStocktake(args.scope, args.freezeItems),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stocktakes"] }),
  });
}

export function useCountStocktakeLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { stocktakeId: string; productId: string; countedQty: string }) =>
      countStocktakeLine(args.stocktakeId, args.productId, args.countedQty),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stocktakes"] }),
  });
}

export function useMoveStocktakeToReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => moveStocktakeToReview(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stocktakes"] }),
  });
}

export function usePostStocktake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postStocktake(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stocktakes"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    },
  });
}

export function useTransfers() {
  return useQuery({ queryKey: ["transfers"], queryFn: listTransfers });
}

export function useCreateTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { fromLocationId: string; toLocationId: string; lines: { productId: string; qty: string }[] }) =>
      createTransfer(args.fromLocationId, args.toLocationId, args.lines),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["transfers"] }),
  });
}

export function useReceiveTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { transferId: string; received: { productId: string; qty: string }[] }) =>
      receiveTransfer(args.transferId, args.received),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
