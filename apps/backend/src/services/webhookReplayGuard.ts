/**
 * Replay protection for inbound wearable webhooks (Terra, ROOK).
 *
 * HMAC signature verification (terra.ts / rook.ts) proves a request came
 * from the provider and wasn't tampered with, but it does nothing to stop
 * the *same* valid, signed payload from being POSTed again — captured off
 * the wire, or genuinely re-delivered by the provider's own retry logic.
 * Since a webhook handler can perform a write (e.g. auth/deauth device
 * linking) for every request it accepts, that gap matters.
 *
 * This dedupes on a hash of (scope, signature header, raw body) with a
 * short TTL: the first request within the window proceeds, an identical
 * one within the same window is reported as already-processed instead of
 * running the handler again. Fails open (treats the request as new) when
 * Redis is unavailable — same tradeoff idempotency.ts makes — so a Redis
 * outage degrades replay protection rather than dropping real webhook
 * deliveries for a healthcare data pipeline.
 */
import crypto from 'crypto';
import { getRedis } from './redis';

const REPLAY_TTL_SECONDS = Math.max(
  30,
  parseInt(process.env.WEBHOOK_REPLAY_TTL_SECONDS ?? '300', 10) || 300
);

/**
 * Returns true if this exact (scope, signature, body) combination was
 * already seen within the TTL window — i.e. this request is a replay and
 * should not be reprocessed. Returns false for a genuinely new request,
 * and also (fail-open) whenever Redis can't be reached.
 */
export async function isWebhookReplay(
  scope: string,
  signature: string,
  rawBody: Buffer
): Promise<boolean> {
  const digest = crypto
    .createHash('sha256')
    .update(signature)
    .update(rawBody)
    .digest('hex');
  const key = `webhook:replay:${scope}:${digest}`;

  let redis;
  try {
    redis = getRedis();
  } catch {
    console.warn(`[webhookReplayGuard] Redis unavailable — replay protection disabled for ${scope}`);
    return false;
  }

  try {
    const stored = await redis.set(key, '1', 'EX', REPLAY_TTL_SECONDS, 'NX');
    return stored === null; // null = key already existed = replay
  } catch (err) {
    console.warn(`[webhookReplayGuard] Redis error — failing open for ${scope}:`, err);
    return false;
  }
}
