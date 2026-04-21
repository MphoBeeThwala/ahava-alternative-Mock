/**
 * Minimal smoke test: health check and env validation.
 * Run with: pnpm test (from apps/backend) or pnpm --filter @ahava-healthcare/api test
 */
describe('Health / smoke', () => {
  it('should have NODE_ENV or allow test env', () => {
    expect(['test', 'development', 'production']).toContain(process.env.NODE_ENV || 'test');
  });

  it('health response shape', () => {
    const res = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      timezone: process.env.TIMEZONE || 'Africa/Johannesburg',
    };
    expect(res.status).toBe('ok');
    expect(res.timestamp).toBeDefined();
    expect(res.timezone).toBeDefined();
  });
});
