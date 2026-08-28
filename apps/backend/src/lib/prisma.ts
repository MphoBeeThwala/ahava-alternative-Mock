import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Connection pool sizing for PgBouncer (Railway's POOLED_DATABASE_URL).
 *
 * With 3 backend replicas serving up to 5000 concurrent users, connecting
 * directly to Postgres (1 connection per in-flight request, no pooling)
 * quickly exhausts Postgres's max_connections (~100) and manifests as
 * "Connection reset by peer" errors under load.
 *
 * POOLED_DATABASE_URL points at Railway's PgBouncer instance running in
 * transaction pooling mode, which multiplexes many client connections onto
 * a small number of real Postgres connections. We additionally cap Prisma's
 * own per-replica connection pool via `connection_limit` so that 3 replicas
 * don't each open Prisma's default pool size (num_cpus * 2 + 1) against
 * PgBouncer - keeping the total client-side connection count predictable
 * (3 replicas * 10 = 30 connections into PgBouncer, comfortably under
 * Postgres's connection limit) while PgBouncer absorbs the burst of 5000
 * concurrent requests.
 */
const POOL_CONNECTION_LIMIT = process.env.PRISMA_CONNECTION_LIMIT ?? '10';
const POOL_TIMEOUT_SECONDS = process.env.PRISMA_POOL_TIMEOUT ?? '20';

function buildPooledDatabaseUrl(): string | undefined {
  const baseUrl = process.env.POOLED_DATABASE_URL || process.env.DATABASE_URL;
  if (!baseUrl) return undefined;

  const url = new URL(baseUrl);

  // Required by Prisma when talking to PgBouncer in transaction pooling mode
  // (disables reliance on named prepared statements / advisory locks that
  // PgBouncer transaction mode doesn't support across pooled connections).
  if (!url.searchParams.has('pgbouncer')) {
    url.searchParams.set('pgbouncer', 'true');
  }
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', POOL_CONNECTION_LIMIT);
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', POOL_TIMEOUT_SECONDS);
  }

  return url.toString();
}

const pooledDatabaseUrl = buildPooledDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    ...(pooledDatabaseUrl
      ? {
          datasources: {
            db: {
              url: pooledDatabaseUrl,
            },
          },
        }
      : {}),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
