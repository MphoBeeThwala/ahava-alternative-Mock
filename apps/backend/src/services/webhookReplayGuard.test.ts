/**
 * isWebhookReplay's own logic, mocking Redis directly (rateLimiter.test.ts's
 * comment explains why: getRedis() throws whenever Redis hasn't been
 * initialized, the default state in this test environment) — the
 * corresponding end-to-end "does a real duplicate delivery actually get
 * blocked" behavior is covered against a real Redis in
 * routes/webhooks.integration.test.ts.
 */
import { isWebhookReplay } from './webhookReplayGuard';
import { getRedis } from './redis';

jest.mock('./redis');

const mockGetRedis = getRedis as jest.MockedFunction<typeof getRedis>;

describe('isWebhookReplay', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is not a replay on the first sighting of a (scope, signature, body) combination', async () => {
    mockGetRedis.mockReturnValue({
      set: jest.fn().mockResolvedValue('OK'), // NX lock acquired
    } as any);

    const result = await isWebhookReplay('terra', 'sig-1', Buffer.from('{"a":1}'));

    expect(result).toBe(false);
  });

  it('is a replay when the key was already set (NX returned null)', async () => {
    mockGetRedis.mockReturnValue({
      set: jest.fn().mockResolvedValue(null), // NX: key already exists
    } as any);

    const result = await isWebhookReplay('terra', 'sig-1', Buffer.from('{"a":1}'));

    expect(result).toBe(true);
  });

  it('scopes the dedup key so the same signature+body under a different source never collide', async () => {
    const redisSet = jest.fn().mockResolvedValue('OK');
    mockGetRedis.mockReturnValue({ set: redisSet } as any);

    await isWebhookReplay('terra', 'same-sig', Buffer.from('same-body'));
    await isWebhookReplay('rook', 'same-sig', Buffer.from('same-body'));

    const [terraKey] = redisSet.mock.calls[0];
    const [rookKey] = redisSet.mock.calls[1];
    expect(terraKey).not.toBe(rookKey);
    expect(terraKey).toContain('terra');
    expect(rookKey).toContain('rook');
  });

  it('a different body under the same signature is not treated as the same delivery', async () => {
    const redisSet = jest.fn().mockResolvedValue('OK');
    mockGetRedis.mockReturnValue({ set: redisSet } as any);

    await isWebhookReplay('terra', 'sig-1', Buffer.from('body-a'));
    await isWebhookReplay('terra', 'sig-1', Buffer.from('body-b'));

    const [keyA] = redisSet.mock.calls[0];
    const [keyB] = redisSet.mock.calls[1];
    expect(keyA).not.toBe(keyB);
  });

  it('sets the dedup key with an expiry, not forever', async () => {
    const redisSet = jest.fn().mockResolvedValue('OK');
    mockGetRedis.mockReturnValue({ set: redisSet } as any);

    await isWebhookReplay('terra', 'sig-1', Buffer.from('body'));

    expect(redisSet).toHaveBeenCalledWith(
      expect.any(String),
      '1',
      'EX',
      expect.any(Number),
      'NX'
    );
  });

  it('fails open (not a replay) when Redis is unavailable', async () => {
    mockGetRedis.mockImplementation(() => {
      throw new Error('Redis not initialized');
    });

    const result = await isWebhookReplay('terra', 'sig-1', Buffer.from('body'));

    expect(result).toBe(false);
  });

  it('fails open (not a replay) when a Redis command errors', async () => {
    mockGetRedis.mockReturnValue({
      set: jest.fn().mockRejectedValue(new Error('connection reset')),
    } as any);

    const result = await isWebhookReplay('terra', 'sig-1', Buffer.from('body'));

    expect(result).toBe(false);
  });
});
