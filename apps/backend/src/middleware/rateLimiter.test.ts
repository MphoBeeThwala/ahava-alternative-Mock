/**
 * AH-02b: rate limiting moved to a Redis-backed store so limits are shared
 * across replicas. The one property worth pinning here isn't the Redis path
 * (that needs a live Redis and is already well-covered by rate-limit-redis's
 * own tests) — it's that this app never depends on Redis being reachable
 * just to answer a request. `getRedis()` throws whenever Redis hasn't been
 * initialized (REDIS_URL unset, or a connection failure at startup), which
 * is the default state in this test environment, so every test below
 * exercises the real fallback path, not a mock standing in for one.
 */
import { ResilientRateLimitStore } from "./rateLimiter";
import type { Options } from "express-rate-limit";

function minimalOptions(windowMs: number): Options {
  return { windowMs } as Options;
}

describe("ResilientRateLimitStore", () => {
  it("still counts hits when Redis is unavailable", async () => {
    const store = new ResilientRateLimitStore("test:");
    store.init(minimalOptions(60_000));

    // The underlying MemoryStore fallback returns a live reference into its
    // internal map, mutated in place on each call for the same key — read
    // totalHits immediately, rather than comparing two held-onto objects
    // after the fact (which would both reflect the latest mutation).
    const firstHits = (await store.increment("client-a")).totalHits;
    const secondHits = (await store.increment("client-a")).totalHits;

    expect(firstHits).toBe(1);
    expect(secondHits).toBe(2);
  });

  it("keeps separate counts per key", async () => {
    const store = new ResilientRateLimitStore("test:");
    store.init(minimalOptions(60_000));

    await store.increment("client-a");
    const b = await store.increment("client-b");

    expect(b.totalHits).toBe(1);
  });

  it("decrements without throwing", async () => {
    const store = new ResilientRateLimitStore("test:");
    store.init(minimalOptions(60_000));

    await store.increment("client-c");
    await store.increment("client-c");
    await expect(store.decrement("client-c")).resolves.toBeUndefined();
  });

  it("resets a key without throwing, and the next hit starts fresh", async () => {
    const store = new ResilientRateLimitStore("test:");
    store.init(minimalOptions(60_000));

    await store.increment("client-d");
    await store.increment("client-d");
    await store.resetKey("client-d");

    const afterReset = await store.increment("client-d");
    expect(afterReset.totalHits).toBe(1);
  });

  it("does not propagate a Redis failure to the caller", async () => {
    const store = new ResilientRateLimitStore("test:");
    store.init(minimalOptions(60_000));

    await expect(store.increment("client-e")).resolves.toBeDefined();
    await expect(store.decrement("client-e")).resolves.toBeUndefined();
    await expect(store.resetKey("client-e")).resolves.toBeUndefined();
  });
});
