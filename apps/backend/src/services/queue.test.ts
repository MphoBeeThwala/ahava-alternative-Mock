/**
 * Same convention as rateLimiter.test.ts / evidenceProvider/combiner.test.ts:
 * no live Redis in this test environment, so BullMQ Queue/Worker construction
 * isn't something to fake here — the one thing worth pinning without it is
 * that a graceful shutdown never breaks on a replica where Redis/queues were
 * never initialized in the first place (REDIS_URL unset), which is this
 * environment's actual default state.
 */
import { closeQueues } from "./queue";

describe("closeQueues", () => {
  it("is a safe no-op when queues were never initialized", async () => {
    await expect(closeQueues()).resolves.toBeUndefined();
  });

  it("does not hang waiting on anything when nothing was initialized", async () => {
    const start = Date.now();
    await closeQueues();
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
