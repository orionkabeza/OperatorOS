import { useQuery } from "@tanstack/react-query";
import { getIdentity } from "../api/identity";
import { useAuthStore } from "../auth-store";

export const IDENTITY_KEY = ["identity"] as const;

/** Gated on sign-in for the same reason useDayStatus is: `GET /users/me`
 *  signed-out is a certain 401, and failures surface globally now. */
export function useIdentity() {
  const signedIn = useAuthStore((s) => s.signedIn);
  return useQuery({ queryKey: IDENTITY_KEY, queryFn: getIdentity, enabled: signedIn });
}
