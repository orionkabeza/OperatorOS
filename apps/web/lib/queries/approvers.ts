import { useQuery } from "@tanstack/react-query";
import { listApprovers } from "../api/manager-override";

/**
 * The staff who can approve a given override. Cached for the session —
 * the list changes only when someone's role does, and re-fetching it on
 * every keystroke in a discount field would be pointless traffic.
 */
export function useApprovers(capability: string) {
  return useQuery({
    queryKey: ["approvers", capability],
    queryFn: () => listApprovers(capability),
    staleTime: 5 * 60_000,
  });
}
