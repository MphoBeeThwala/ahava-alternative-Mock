/**
 * With Redis unavailable the counters must still count (an outage used to
 * switch lockout off). Redis is mocked to throw so this exercises only the
 * in-process fallback.
 */
jest.mock('./redis', () => ({
  getRedis: () => { throw new Error('redis unavailable'); },
}));

import {
  MAX_ATTEMPTS_PER_ACCOUNT, MAX_ATTEMPTS_PER_IP,
  _resetMemoryForTests, checkLoginAllowed, clearLoginFailures, recordLoginFailure,
} from './loginThrottle';

beforeEach(() => _resetMemoryForTests());

describe('loginThrottle (no Redis)', () => {
  it('blocks an IP after repeated failures for one account, without blocking other IPs', async () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP; i++) await recordLoginFailure('nurse@example.test', '203.0.113.1');

    const attacker = await checkLoginAllowed('nurse@example.test', '203.0.113.1');
    expect(attacker).toMatchObject({ blocked: true, scope: 'ip' });
    expect(await checkLoginAllowed('nurse@example.test', '198.51.100.7')).toEqual({ blocked: false });
    expect(await checkLoginAllowed('other@example.test', '203.0.113.1')).toEqual({ blocked: false });
  });

  it('blocks the account everywhere once failures from many IPs add up', async () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_ACCOUNT; i++) await recordLoginFailure('admin@example.test', `192.0.2.${i}`);

    expect(await checkLoginAllowed('admin@example.test', '198.51.100.99')).toMatchObject({ blocked: true, scope: 'account' });
  });

  it('treats email case differences as the same account', async () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP; i++) await recordLoginFailure(i % 2 ? 'Doc@Example.test' : 'doc@example.test', '203.0.113.2');

    expect(await checkLoginAllowed('DOC@EXAMPLE.TEST', '203.0.113.2')).toMatchObject({ blocked: true });
  });

  it('a successful login clears that IP but not the account-wide count', async () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP; i++) await recordLoginFailure('p@example.test', '203.0.113.3');
    await clearLoginFailures('p@example.test', '203.0.113.3');

    expect(await checkLoginAllowed('p@example.test', '203.0.113.3')).toEqual({ blocked: false });
    for (let i = 0; i < MAX_ATTEMPTS_PER_ACCOUNT - MAX_ATTEMPTS_PER_IP; i++) await recordLoginFailure('p@example.test', `192.0.2.${i}`);
    expect(await checkLoginAllowed('p@example.test', '203.0.113.50')).toMatchObject({ blocked: true, scope: 'account' });
  });
});
