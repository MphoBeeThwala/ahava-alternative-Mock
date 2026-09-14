/**
 * Caching layer for PubMed/StatPearls (both share NCBI's rate-limited
 * infrastructure). Same convention as rateLimiter.test.ts: this test
 * environment has no live Redis (REDIS_URL unset), so getRedis() throws —
 * these tests pin the real fallback path a missing/unreachable Redis takes,
 * not a mocked cache hit (that needs a live Redis and is already covered by
 * ioredis's own tests).
 */
import { queryWithCache } from "./combiner";
import type { EvidenceProvider, EvidenceResult } from "./types";

function fakeProvider(overrides: Partial<EvidenceProvider["config"]> = {}): {
  provider: EvidenceProvider;
  callCount: () => number;
} {
  let calls = 0;
  const result: EvidenceResult = {
    sourceId: "fake",
    content: "fake content",
    citation: "fake citation",
    retrievedAt: new Date().toISOString(),
  };
  const provider: EvidenceProvider = {
    id: "fake",
    tier: "literature",
    config: { id: "fake", tier: "literature", enabled: true, ...overrides },
    query: async () => {
      calls += 1;
      return [result];
    },
  };
  return { provider, callCount: () => calls };
}

describe("queryWithCache", () => {
  it("queries directly when the provider has no cacheTtlSeconds configured", async () => {
    const { provider, callCount } = fakeProvider(); // no cacheTtlSeconds
    await queryWithCache(provider, { symptoms: "persistent cough" });
    await queryWithCache(provider, { symptoms: "persistent cough" });

    expect(callCount()).toBe(2);
  });

  it("queries directly when symptoms are empty, even with caching configured", async () => {
    const { provider, callCount } = fakeProvider({ cacheTtlSeconds: 3600 });
    await queryWithCache(provider, { symptoms: "" });

    expect(callCount()).toBe(1);
  });

  it("falls through to a live query when Redis is unavailable, rather than failing the lookup", async () => {
    // REDIS_URL is unset in this test environment, so getRedis() throws —
    // this exercises the real fail-open path, not a mock standing in for one.
    const { provider, callCount } = fakeProvider({ cacheTtlSeconds: 3600 });

    const results = await queryWithCache(provider, { symptoms: "chest pain" });

    expect(results).toHaveLength(1);
    expect(results[0].sourceId).toBe("fake");
    expect(callCount()).toBe(1);
  });

  it("still returns correct results across repeated calls when caching is configured but unreachable", async () => {
    const { provider, callCount } = fakeProvider({ cacheTtlSeconds: 3600 });

    await queryWithCache(provider, { symptoms: "fever and chills" });
    await queryWithCache(provider, { symptoms: "fever and chills" });

    // Without a live Redis, each call queries live — this pins that the
    // absence of a cache never breaks correctness, only the optimization.
    expect(callCount()).toBe(2);
  });
});
