import prisma from '../lib/prisma';
import { getRedis } from './redis';

/**
 * Sign a user out everywhere: every refresh token (the long-lived half of a
 * session) is removed from the database and from the Redis fast path. A
 * refresh can't be renewed without its database row, so this ends every
 * session within one access-token lifetime (15 min) at most.
 *
 * Used after a password change or reset, a 2FA reset, and admin recovery.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const tokens = await prisma.refreshToken.findMany({ where: { userId }, select: { token: true } });
  try {
    const redis = getRedis();
    if (tokens.length) await redis.del(...tokens.map((t) => `refresh:${t.token}`));
  } catch { /* redis unavailable — the database delete below is what revokes */ }
  const { count } = await prisma.refreshToken.deleteMany({ where: { userId } });
  return count;
}
