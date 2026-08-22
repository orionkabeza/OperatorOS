import { apiRequest, getDefaultLocationId, USE_MOCK_API } from "./config";
import { BUSINESS_NAME, CURRENT_USER_NAME, LOCATION_ID, LOCATION_NAME } from "../mock/seed";
import { mockDelay } from "../mock/store";
import { schemas } from "./generated/client";

export interface Identity {
  /** The shop's own trading name — what the top bar reads on every screen. */
  businessName: string;
  /** The branch the signed-in user is working at. */
  locationName: string;
  locationId: string;
  displayName: string;
  /** Up to two letters for the avatar. */
  initials: string;
}

/**
 * Who is signed in, and to which shop.
 *
 * This exists because `TopNav` had no source for any of it and shipped
 * constants instead: `businessName = "Kigali Hardware Supplies"` as a default
 * prop that `ShopFloor` never overrode, a hard-coded "Nyabugogo branch", and
 * the initials "AM". Those are the mock fixture's values, so in production
 * every real tenant saw another shop's name and a branch they do not have
 * sitting above their own till.
 *
 * `GET /api/v1/users/me` now carries `business_name` and named `locations`
 * (apps/api/schemas/users.py) — neither existed before, which is why the
 * component had nothing better to render.
 */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? [words[0]![0]] : [words[0]![0], words[words.length - 1]![0]];
  return letters.join("").toUpperCase();
}

export async function getIdentity(): Promise<Identity> {
  if (USE_MOCK_API) {
    return mockDelay({
      businessName: BUSINESS_NAME,
      locationName: LOCATION_NAME,
      locationId: LOCATION_ID,
      displayName: CURRENT_USER_NAME,
      initials: initialsOf(CURRENT_USER_NAME),
    });
  }

  const me = schemas.MeOut.parse(await apiRequest<unknown>("GET", "/api/v1/users/me"));
  const locationId = await getDefaultLocationId();
  const location = me.locations.find((l) => l.id === locationId) ?? me.locations[0];

  return {
    businessName: me.business_name,
    // A location with no row behind it is possible in principle; naming it
    // "—" is honest, where a placeholder branch name would repeat exactly
    // the mistake this module exists to fix.
    locationName: location?.name ?? "—",
    locationId,
    displayName: me.display_name,
    initials: initialsOf(me.display_name),
  };
}
