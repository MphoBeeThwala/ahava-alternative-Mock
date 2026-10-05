/**
 * Failed-attempt throttling for credential checks (password login, 2FA
 * codes, step-up codes).
 *
 * Two counters guard a password login:
 *  - per account AND source IP (LOGIN_MAX_ATTEMPTS_PER_IP, default 5): an
 *    attacker is slowed down without locking the real owner out, who is
 *    typically on a different IP;
 *  - per account across all IPs (LOGIN_MAX_ATTEMPTS_PER_ACCOUNT, default 25):
 *    stops a distributed guessing run. Higher than the per-IP limit, so
 *    tripping it to lock someone out costs an attacker five times the effort
 *    the old single counter (keyed on email alone) did.
 *
 * Counters live in Redis. If Redis is unavailable they fall back to an
 * in-process table instead of switching off, so a Redis outage degrades
 * protection to "per replica" rather than removing it. (This used to fail
 * open, exactly when infrastructure was already struggling.)
 */
import { getRedis } from './redis';

export const WINDOW_SECONDS = Math.max(60, parseInt(process.env.AUTH_LOCKOUT_TTL_SECONDS ?? '900', 10) || 900);
export const MAX_ATTEMPTS_PER_IP = Math.max(1, parseInt(process.env.LOGIN_MAX_ATTEMPTS_PER_IP ?? process.env.AUTH_LOCKOUT_MAX_ATTEMPTS ?? '5', 10) || 5);
export const MAX_ATTEMPTS_PER_ACCOUNT = Math.max(1, parseInt(process.env.LOGIN_MAX_ATTEMPTS_PER_ACCOUNT ?? '25', 10) || 25);

// ---- counters: Redis first, in-process fallback ---------------------------

// The shared Redis client queues commands while disconnected (BullMQ needs
// that), so a down Redis would hang a login rather than fail it. A short
// deadline turns "down" into "fall back to the in-process table".
const REDIS_DEADLINE_MS = 300;
function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('redis deadline')), REDIS_DEADLINE_MS);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

const memory = new Map<string, { count: number; expiresAt: number }>();
const MEMORY_MAX_ENTRIES = 20_000;

function memoryGet(key: string, now = Date.now()) {
  const entry = memory.get(key);
  if (entry && entry.expiresAt <= now) {
    memory.delete(key);
    return undefined;
  }
  return entry;
}

function memoryHit(key: string, limit: number, windowSeconds: number, now = Date.now()): number {
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
    // Still full of live entries: drop the oldest rather than grow without bound.
    if (memory.size >= MEMORY_MAX_ENTRIES) memory.delete(memory.keys().next().value as string);
  }
  const entry = memoryGet(key, now);
  const count = (entry?.count ?? 0) + 1;
  // First failure opens the window; reaching the limit holds the lock for a full window.
  const expiresAt = !entry || count >= limit ? now + windowSeconds * 1000 : entry.expiresAt;
  memory.set(key, { count, expiresAt });
  return count;
}

/** Record one failure. Returns the new count (best effort). */
export async function hit(key: string, limit: number, windowSeconds = WINDOW_SECONDS): Promise<number> {
  try {
    const redis = getRedis();
    const count = await withDeadline(redis.incr(key));
    if (count === 1 || count === limit) await withDeadline(redis.expire(key, windowSeconds));
    return count;
  } catch {
    return memoryHit(key, limit, windowSeconds);
  }
}

/** Seconds left on the lock if `key` has reached `limit`, else 0. */
export async function lockedSeconds(key: string, limit: number): Promise<number> {
  try {
    const redis = getRedis();
    const count = Number((await withDeadline(redis.get(key))) ?? 0);
    if (count >= limit) return Math.max(1, await withDeadline(redis.ttl(key)));
    // Redis is up, but a failure recorded while it was down still counts.
  } catch { /* fall through to the in-process table */ }
  const entry = memoryGet(key);
  return entry && entry.count >= limit ? Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000)) : 0;
}

export async function reset(key: string): Promise<void> {
  memory.delete(key);
  try { await withDeadline(getRedis().del(key)); } catch { /* nothing more to clear */ }
}

// ---- password login --------------------------------------------------------

const norm = (email: string) => email.trim().toLowerCase();
const pairKey = (email: string, ip: string) => `auth:fail:pair:${norm(email)}:${ip || 'unknown'}`;
const accountKey = (email: string) => `auth:fail:acct:${norm(email)}`;

export type LoginBlock = { blocked: false } | { blocked: true; scope: 'ip' | 'account'; retryAfterSeconds: number };

export async function checkLoginAllowed(email: string, ip: string): Promise<LoginBlock> {
  const [ipLock, accountLock] = await Promise.all([
    lockedSeconds(pairKey(email, ip), MAX_ATTEMPTS_PER_IP),
    lockedSeconds(accountKey(email), MAX_ATTEMPTS_PER_ACCOUNT),
  ]);
  if (accountLock > 0) return { blocked: true, scope: 'account', retryAfterSeconds: accountLock };
  if (ipLock > 0) return { blocked: true, scope: 'ip', retryAfterSeconds: ipLock };
  return { blocked: false };
}

export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  await Promise.all([
    hit(pairKey(email, ip), MAX_ATTEMPTS_PER_IP),
    hit(accountKey(email), MAX_ATTEMPTS_PER_ACCOUNT),
  ]);
}

/**
 * A correct password clears this IP's counter only. The account-wide counter
 * is left to expire: otherwise the owner signing in would hand an attacker
 * running a distributed guess a fresh allowance every time.
 */
export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  await reset(pairKey(email, ip));
}

/** Test helper. */
export function _resetMemoryForTests() { memory.clear(); }
