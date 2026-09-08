/**
 * AH-08: middleware/auth.ts's local cache is invalidated on other replicas
 * by publishing over the same Redis pub/sub channel this file already uses
 * for WebSocket delivery. The actual cross-instance dispatch (a message
 * arriving via Redis and reaching the registered handler) needs a live
 * Redis connection to exercise for real, which this file has no existing
 * tests for either — so this pins only what's testable without one: the
 * registration and publish calls middleware/auth.ts makes behave safely
 * when Redis isn't configured, the same graceful-without-Redis contract
 * every other pub/sub call in this file already has.
 */
import { onAuthCacheInvalidate, publishAuthCacheInvalidation } from "./websocket";

describe("auth cache invalidation pub/sub", () => {
  it("accepts a handler registration without throwing", () => {
    expect(() => onAuthCacheInvalidate(() => {})).not.toThrow();
  });

  it("does not throw when publishing without a configured Redis connection", () => {
    // REDIS_URL is unset in this test environment, so this exercises the
    // same "pub/sub unavailable" fallback path sendToUser/broadcastToUsers
    // already rely on — a warning logged once, not an error surfaced to
    // the caller. middleware/auth.ts's invalidateCachedUser must never
    // fail a request just because cross-replica delivery isn't set up.
    expect(() => publishAuthCacheInvalidation("user-123")).not.toThrow();
  });
});
