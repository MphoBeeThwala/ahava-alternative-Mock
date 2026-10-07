/**
 * Every Redis connection looks up IPv4 and IPv6 (family 0), so Railway's private
 * network address works. ioredis 5 defaults to this already; the tests pin it so a
 * library change or an edit here cannot quietly drop back to IPv4-only.
 */
import Redis from 'ioredis';
import { initializeRedis, normalizeRedisUrl, REDIS_NETWORK_OPTIONS } from './redis';

jest.mock('ioredis', () => {
  const ctor = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  }));
  return { __esModule: true, default: ctor };
});

describe('redis connection options', () => {
  afterEach(() => jest.clearAllMocks());

  it('is dual-stack: 0 means either address family, not 4 (IPv4 only)', () => {
    expect(REDIS_NETWORK_OPTIONS).toEqual({ family: 0 });
  });

  it('the shared client passes family 0 to ioredis, with its own settings intact', async () => {
    process.env.REDIS_URL = 'redis://default:pw@redis.railway.internal:6379';
    await initializeRedis();
    const [url, options] = (Redis as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe('redis://default:pw@redis.railway.internal:6379');
    expect(options).toMatchObject({ family: 0, connectTimeout: 3000, lazyConnect: true, maxRetriesPerRequest: null });
  });

  it('still repairs a REDIS_URL that lost its scheme, whatever the host', () => {
    expect(normalizeRedisUrl('//default:pw@redis.railway.internal:6379')).toBe('redis://default:pw@redis.railway.internal:6379');
    expect(normalizeRedisUrl('rediss://x@h:1')).toBe('rediss://x@h:1');
  });
});
