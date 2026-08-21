import { useMutation, useQuery } from "@tanstack/react-query";
import { getPayLink, getPayLinkStatus, submitPayLink } from "../api/pay";

export function usePayLink(token: string) {
  return useQuery({ queryKey: ["pay-link", token], queryFn: () => getPayLink(token) });
}

/** Polls while the sandbox settlement is pending — `refetchInterval` stops itself once the status leaves "pending". */
export function usePayLinkStatusPoll(token: string, enabled: boolean) {
  return useQuery({
    queryKey: ["pay-link-status", token],
    queryFn: () => getPayLinkStatus(token),
    enabled,
    refetchInterval: (query) => (query.state.data === "pending" ? 1_000 : false),
  });
}

export function useSubmitPayLink(token: string) {
  return useMutation({
    mutationFn: (args: { method: "momo" | "airtel"; phone: string }) => submitPayLink(token, args.method, args.phone),
  });
}
