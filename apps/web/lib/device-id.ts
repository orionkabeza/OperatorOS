const DEVICE_ID_KEY = "operatoros_device_id";

/** A stable per-browser id for the login lockout's per-device scoping
 * (spec D.1: "3 failed attempts locks the DEVICE for 15 minutes", not
 * the account) and the "keep signed in" device-trust window. Generated
 * once and persisted -- not derived from anything identifying the real
 * hardware, just a random id this browser profile keeps reusing. */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
