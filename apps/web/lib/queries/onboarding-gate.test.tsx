import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { DaySession } from "../api/types";

const getDayStatus = vi.fn<() => Promise<DaySession>>();

vi.mock("../api/day", () => ({
  getDayStatus: () => getDayStatus(),
  openDay: vi.fn(),
  closeDay: vi.fn(),
  reopenDay: vi.fn(),
  getDayCloseChecklist: vi.fn(),
  getDaySummary: vi.fn(),
}));

const { useOnboardingGate } = await import("./onboarding");
const { useAuthStore } = await import("../auth-store");
const { createQueryClient } = await import("../query-client");
const { EMPTY_ONBOARDING_STATE } = await import("../api/onboarding");

const SLUG = "demo-c6ed09";

function daySession(status: DaySession["status"]): DaySession {
  return {
    id: status === "open" ? "day-1" : "",
    businessDate: "2026-08-22",
    locationId: "loc-1",
    status,
    openedAt: status === "open" ? "2026-08-22T06:00:00Z" : null,
    openedBy: null,
    closedAt: null,
    closedBy: null,
    countedMinor: null,
    expectedMinor: null,
    varianceMinor: null,
    reason: null,
    reasonNote: null,
  };
}

/** A fresh QueryClient per test -- built here rather than inline, because
 *  renderHook re-invokes the wrapper on every render and a client created
 *  in there would be replaced on each one. */
function wrapper() {
  const client = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function storedFlag() {
  const raw = window.localStorage.getItem(`operatoros.onboarding.v1.${SLUG}`);
  return raw ? (JSON.parse(raw) as { completed: boolean }).completed : null;
}

describe("useOnboardingGate", () => {
  beforeEach(() => {
    window.localStorage.clear();
    getDayStatus.mockReset();
    useAuthStore.setState({ signedIn: true, businessSlug: SLUG, rememberedSlug: SLUG });
  });

  // The lockout this exists for. A shop whose day was already open, in a
  // browser with no wizard state (cleared storage, a different machine),
  // was put back at step 1 of setup -- and the only way out of setup is
  // "Open the shop", which the API answers 409 "The shop is already open at
  // this location." No forward, no back, no dismissal.
  it("sends a browser that has forgotten setup to the shop floor when the day is open", async () => {
    getDayStatus.mockResolvedValue(daySession("open"));
    const { result } = renderHook(() => useOnboardingGate(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.decided).toBe(true));
    expect(result.current.fittedOut).toBe(true);
  });

  // Inferring it every time would be enough until tonight: once the day is
  // closed the inference goes away, and the wizard would be back tomorrow.
  it("writes the flag back so closing the day doesn't reopen the wizard", async () => {
    getDayStatus.mockResolvedValue(daySession("open"));
    renderHook(() => useOnboardingGate(), { wrapper: wrapper() });

    await waitFor(() => expect(storedFlag()).toBe(true));
  });

  it("still shows setup to a genuinely new business with no open day", async () => {
    getDayStatus.mockResolvedValue(daySession("closed"));
    const { result } = renderHook(() => useOnboardingGate(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.decided).toBe(true));
    expect(result.current.fittedOut).toBe(false);
    expect(storedFlag()).toBe(null);
  });

  // A tenant who has finished setup shouldn't see the wizard flash on every
  // load while the day request is in flight.
  it("withholds a verdict until the day status is known", async () => {
    let release: (d: DaySession) => void = () => undefined;
    getDayStatus.mockReturnValue(new Promise<DaySession>((resolve) => { release = resolve; }));

    const { result } = renderHook(() => useOnboardingGate(), { wrapper: wrapper() });
    expect(result.current.decided).toBe(false);

    release(daySession("open"));
    await waitFor(() => expect(result.current.decided).toBe(true));
  });

  it("honours a stored completion even before the day resolves as closed", async () => {
    window.localStorage.setItem(
      `operatoros.onboarding.v1.${SLUG}`,
      JSON.stringify({ ...EMPTY_ONBOARDING_STATE, completed: true }),
    );
    getDayStatus.mockResolvedValue(daySession("closed"));

    const { result } = renderHook(() => useOnboardingGate(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.decided).toBe(true));
    expect(result.current.fittedOut).toBe(true);
  });
});
