import { beforeEach, describe, expect, it } from "vitest";
import { clearCacheOnAuthChange, createQueryClient } from "./query-client";
import { ApiError } from "./api/config";
import { useToastStore } from "./toast-store";
import { useAuthStore } from "./auth-store";

function messages() {
  return useToastStore.getState().toasts.map((t) => t.message);
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("global request-error surfacing", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  // The regression this exists for: a failing mutation used to produce no
  // visible change at all, so a 500 and a successful no-op were
  // indistinguishable. "Open the shop" looked like a dead button in
  // production for hours because of exactly this.
  it("shows a message when a mutation fails", async () => {
    const client = createQueryClient();
    await client
      .getMutationCache()
      .build(client, {
        mutationFn: async () => {
          throw new ApiError('{"detail":"The till doesn\'t match yesterday\'s close."}', 422);
        },
      })
      .execute(undefined)
      .catch(() => undefined);
    await settle();

    expect(messages()).toEqual(["The till doesn't match yesterday's close."]);
  });

  it("translates a 500 into something a shopkeeper can act on", async () => {
    const client = createQueryClient();
    await client
      .getMutationCache()
      .build(client, {
        mutationFn: async () => {
          throw new ApiError('{"detail":"Something went wrong on our end."}', 500);
        },
      })
      .execute(undefined)
      .catch(() => undefined);
    await settle();

    expect(messages()[0]).toMatch(/Nothing was saved/i);
  });

  it("stays quiet for a 501 query — those screens explain themselves", async () => {
    const client = createQueryClient();
    await client
      .fetchQuery({
        queryKey: ["unsupported"],
        queryFn: async () => {
          throw new ApiError('{"detail":"Listing past stock transfers — no endpoint exists."}', 501);
        },
      })
      .catch(() => undefined);
    await settle();

    expect(messages()).toEqual([]);
  });

  it("does surface a genuine query failure", async () => {
    const client = createQueryClient();
    await client
      .fetchQuery({
        queryKey: ["broken"],
        queryFn: async () => {
          throw new ApiError('{"detail":"Not found."}', 404);
        },
      })
      .catch(() => undefined);
    await settle();

    expect(messages()).toHaveLength(1);
  });

  it("does not retry a client error, so the failure is reported promptly", async () => {
    const client = createQueryClient();
    let attempts = 0;
    await client
      .fetchQuery({
        queryKey: ["no-retry"],
        queryFn: async () => {
          attempts += 1;
          throw new ApiError('{"detail":"Nope."}', 422);
        },
      })
      .catch(() => undefined);

    expect(attempts).toBe(1);
  });
});

describe("cross-tenant cache hygiene", () => {
  // Signing into a second business on the same device served the first
  // one's cached answers -- business name, day status, everything -- until
  // each query happened to refetch. Showing a shopkeeper another shop's
  // figures even briefly is the failure this codebase treats as
  // build-failing server-side.
  it("drops cached tenant data when someone signs out", () => {
    useAuthStore.setState({ signedIn: true });
    const client = createQueryClient();
    const stop = clearCacheOnAuthChange(client);
    client.setQueryData(["identity"], { businessName: "Kagarama Hardware" });

    useAuthStore.setState({ signedIn: false });

    expect(client.getQueryData(["identity"])).toBeUndefined();
    stop();
  });

  it("drops it on sign-in too, so a second tenant starts clean", () => {
    useAuthStore.setState({ signedIn: false });
    const client = createQueryClient();
    const stop = clearCacheOnAuthChange(client);
    client.setQueryData(["identity"], { businessName: "Previous Shop" });

    useAuthStore.setState({ signedIn: true });

    expect(client.getQueryData(["identity"])).toBeUndefined();
    stop();
  });

  it("leaves the cache alone when nothing about sign-in changed", () => {
    useAuthStore.setState({ signedIn: true, shutterState: "idle" });
    const client = createQueryClient();
    const stop = clearCacheOnAuthChange(client);
    client.setQueryData(["identity"], { businessName: "Kagarama Hardware" });

    // An unrelated store update must not throw the day's data away.
    useAuthStore.setState({ businessSlug: "typing-a-slug" });

    expect(client.getQueryData(["identity"])).toEqual({ businessName: "Kagarama Hardware" });
    stop();
  });

  it("stops listening once unsubscribed", () => {
    useAuthStore.setState({ signedIn: true });
    const client = createQueryClient();
    clearCacheOnAuthChange(client)();
    client.setQueryData(["identity"], { businessName: "Kagarama Hardware" });

    useAuthStore.setState({ signedIn: false });

    expect(client.getQueryData(["identity"])).toEqual({ businessName: "Kagarama Hardware" });
  });
});
