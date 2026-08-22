import { beforeEach, describe, expect, it } from "vitest";
import { createQueryClient } from "./query-client";
import { ApiError } from "./api/config";
import { useToastStore } from "./toast-store";

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
