import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closeTillSession, getOpenTillSession, openTillSession } from "../api/till";
import type { CloseTillInput, OpenTillInput } from "../api/types";

export const TILL_SESSION_KEY = ["till-session"] as const;

export function useTillSession() {
  return useQuery({ queryKey: TILL_SESSION_KEY, queryFn: getOpenTillSession });
}

export function useOpenTill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenTillInput) => openTillSession(input),
    onSuccess: (session) => queryClient.setQueryData(TILL_SESSION_KEY, session),
  });
}

export function useCloseTill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CloseTillInput) => closeTillSession(input),
    onSuccess: () => queryClient.setQueryData(TILL_SESSION_KEY, null),
  });
}
