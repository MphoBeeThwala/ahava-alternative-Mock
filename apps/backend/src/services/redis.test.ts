/**
 * Found in production, 2026-09-15: REDIS_URL on Railway was set without its
 * scheme (`//default:<pw>@redis.railway.internal:6379`), which ioredis
 * can't parse — it connected to a literal empty hostname and failed with
 * ENOENT in an infinite retry loop, silently disabling caching, background
 * jobs, and auth-lockout checks (which fail open without Redis). Pinning
 * the normalization that now tolerates this.
 */
import { normalizeRedisUrl } from "./redis";

describe("normalizeRedisUrl", () => {
  it("passes a well-formed redis:// URL through unchanged", () => {
    expect(normalizeRedisUrl("redis://default:pw@redis.railway.internal:6379")).toBe(
      "redis://default:pw@redis.railway.internal:6379",
    );
  });

  it("passes a well-formed rediss:// (TLS) URL through unchanged", () => {
    expect(normalizeRedisUrl("rediss://default:pw@redis.railway.internal:6379")).toBe(
      "rediss://default:pw@redis.railway.internal:6379",
    );
  });

  it("adds the missing redis:// scheme when it was dropped", () => {
    expect(normalizeRedisUrl("//default:pw@redis.railway.internal:6379")).toBe(
      "redis://default:pw@redis.railway.internal:6379",
    );
  });

  it("adds a scheme to a bare host:port with no leading slashes", () => {
    expect(normalizeRedisUrl("redis.railway.internal:6379")).toBe(
      "redis://redis.railway.internal:6379",
    );
  });
});
