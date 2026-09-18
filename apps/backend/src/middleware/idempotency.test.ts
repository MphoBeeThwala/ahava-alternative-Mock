/**
 * Unit tests for idempotencyMiddleware, mocking the Redis client directly
 * (rather than requiring one to be running) so every branch — cache hit,
 * lock contention, and the "fail open" path when Redis is unreachable —
 * is exercised deterministically.
 */
import { EventEmitter } from 'events';
import { Request, Response } from 'express';
import { idempotencyMiddleware } from './idempotency';
import { getRedis } from '../services/redis';

jest.mock('../services/redis');

const mockGetRedis = getRedis as jest.MockedFunction<typeof getRedis>;

function mockReq(headers: Record<string, string> = {}): Request {
  const lowered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    lowered[key.toLowerCase()] = value;
  }
  return {
    method: 'POST',
    baseUrl: '/api/v1/bookings',
    path: '/',
    header: (name: string) => lowered[name.toLowerCase()],
  } as unknown as Request;
}

function mockRes(): Response & EventEmitter {
  const res = new EventEmitter() as any;
  res.statusCode = 200;
  res.setHeader = jest.fn();
  res.status = jest.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockReturnValue(res);
  return res as Response & EventEmitter;
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('idempotencyMiddleware', () => {
  const middleware = idempotencyMiddleware({ scope: 'booking-create' });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('passes through immediately when no Idempotency-Key header is sent', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockGetRedis).not.toHaveBeenCalled();
  });

  it('rejects a too-short key with 400 before touching Redis', async () => {
    const req = mockReq({ 'Idempotency-Key': 'short' });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    expect(mockGetRedis).not.toHaveBeenCalled();
  });

  it('fails open (calls next) when Redis is unavailable', async () => {
    mockGetRedis.mockImplementation(() => {
      throw new Error('Redis not initialized');
    });
    const req = mockReq({ 'Idempotency-Key': 'a-valid-key-12345' });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('replays a cached response instead of calling next again', async () => {
    const cached = { statusCode: 201, body: { success: true, booking: { id: 'b1' } } };
    mockGetRedis.mockReturnValue({
      get: jest.fn().mockResolvedValue(JSON.stringify(cached)),
      set: jest.fn(),
      del: jest.fn(),
    } as any);
    const req = mockReq({ 'Idempotency-Key': 'a-valid-key-12345' });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-Idempotent-Replay', 'true');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(cached.body);
  });

  it('returns 409 when a duplicate request is already in flight', async () => {
    mockGetRedis.mockReturnValue({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(null), // NX lock not acquired
      del: jest.fn(),
    } as any);
    const req = mockReq({ 'Idempotency-Key': 'a-valid-key-12345' });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'IDEMPOTENCY_IN_PROGRESS' })
    );
  });

  it('on a fresh key: acquires the lock, calls next, then caches the result and releases the lock on finish', async () => {
    const redisSet = jest.fn().mockResolvedValue('OK');
    const redisDel = jest.fn().mockResolvedValue(1);
    mockGetRedis.mockReturnValue({
      get: jest.fn().mockResolvedValue(null),
      set: redisSet,
      del: redisDel,
    } as any);
    const req = mockReq({ 'Idempotency-Key': 'a-valid-key-12345' });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Simulate the route handler responding and Express finishing the response.
    res.statusCode = 201;
    res.json({ success: true, booking: { id: 'b2' } });
    res.emit('finish');
    await flushMicrotasks();

    // First set() call is the NX lock; second is the cached result.
    expect(redisSet).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('idem:result:'),
      JSON.stringify({ statusCode: 201, body: { success: true, booking: { id: 'b2' } } }),
      'EX',
      expect.any(Number)
    );
    expect(redisDel).toHaveBeenCalledWith(expect.stringContaining('idem:lock:'));
  });

  it('does not cache a 5xx response, but still releases the lock', async () => {
    const redisSet = jest.fn().mockResolvedValue('OK');
    const redisDel = jest.fn().mockResolvedValue(1);
    mockGetRedis.mockReturnValue({
      get: jest.fn().mockResolvedValue(null),
      set: redisSet,
      del: redisDel,
    } as any);
    const req = mockReq({ 'Idempotency-Key': 'a-valid-key-12345' });
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    res.statusCode = 500;
    res.json({ success: false, error: 'boom' });
    res.emit('finish');
    await flushMicrotasks();

    // Only the NX lock set — no second call caching a 500 as a replayable result.
    expect(redisSet).toHaveBeenCalledTimes(1);
    expect(redisDel).toHaveBeenCalledWith(expect.stringContaining('idem:lock:'));
  });
});
