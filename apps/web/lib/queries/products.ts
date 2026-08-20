import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createProduct, getProduct, listCategories, listProducts, listUnits } from "../api/products";
import type { CreateProductInput, ProductFilters } from "../api/types";

export function useProducts(filters?: ProductFilters) {
  return useQuery({ queryKey: ["products", filters ?? {}], queryFn: () => listProducts(filters) });
}

export function useProduct(id: string | null) {
  return useQuery({ queryKey: ["product", id], queryFn: () => getProduct(id as string), enabled: Boolean(id) });
}

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: listCategories });
}

export function useUnits() {
  return useQuery({ queryKey: ["units"], queryFn: listUnits });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => createProduct(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}
