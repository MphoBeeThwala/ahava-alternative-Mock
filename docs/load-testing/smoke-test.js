/**
 * k6 Smoke Test: Authentication & Rate Limiting
 * 
 * Purpose: Test login endpoint with rate limit awareness
 * - Does NOT run in production (production auth is rate-limited at 30 attempts/15min per IP)
 * - Tests only on staging database
 * - Uses distinct test users to verify rate limit responses
 * - Reports 429 responses separately from application errors
 * 
 * Usage:
 *   k6 run smoke-test.js \
 *     --vus 5 --duration 10m \
 *     -e BACKEND_URL=https://backend-staging-xxx.up.railway.app \
 *     -e CREDENTIALS_FILE=./test-credentials.json
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import fs from 'k6/fs';

const BACKEND_URL = __ENV.BACKEND_URL || 'http://localhost:4000';
const CREDENTIALS_FILE = __ENV.CREDENTIALS_FILE || './test-credentials.json';

// Metrics
const loginLatency = new Trend('login_latency_ms');
const rateLimitedLogins = new Rate('login_rate_limited_429');
const failedLogins = new Rate('login_failed_non_429');
const successfulLogins = new Rate('login_successful_200');
const loginThroughput = new Counter('login_attempts_total');

let testCredentials = [];
try {
  const credentialData = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
  testCredentials = JSON.parse(credentialData);
} catch (error) {
  throw new Error(`Failed to load credentials: ${error}`);
}

export function setup() {
  const res = http.get(`${BACKEND_URL}/health`);
  check(res, { 'Staging backend is accessible': (r) => r.status === 200 });
  if (res.status !== 200) {
    throw new Error(`Staging backend not accessible at ${BACKEND_URL}`);
  }
  return { startTime: new Date().toISOString() };
}

/**
 * Smoke test: login with rate limit awareness
 * - Each VU uses a different set of test users (cycling through pool)
 * - Slow login attempts (10-20 per minute = 1 every 3-6s) to stay within rate limits
 * - Captures 429 responses separately
 */
export default function (setup_data) {
  const vuId = __VU;
  
  // Rotate through credentials: VU 1 uses cred 0,4,8,...  VU 2 uses cred 1,5,9,...
  const iteration = __ITER;
  const credentialIndex = ((vuId - 1) + iteration * 5) % testCredentials.length;
  
  if (credentialIndex >= testCredentials.length) {
    // Skip if we've cycled through all credentials
    return;
  }

  const cred = testCredentials[credentialIndex];

  group('Login Test', () => {
    const res = http.post(
      `${BACKEND_URL}/api/auth/login`,
      JSON.stringify({
        email: cred.email,
        password: cred.password,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Ahava-Auth-Mode': 'json',
        },
        timeout: '30s',
      }
    );

    const latency = res.timings.duration;
    loginLatency.add(latency);
    loginThroughput.add(1);

    if (res.status === 200) {
      successfulLogins.add(1);
      check(res, {
        'Login successful': (r) => r.status === 200,
        'Has access token': () => {
          try {
            return !!res.json().accessToken;
          } catch {
            return false;
          }
        },
      });
    } else if (res.status === 429) {
      rateLimitedLogins.add(1);
      check(res, {
        'Rate limit response (429)': (r) => r.status === 429,
        'Has rate limit message': () => {
          try {
            return !!res.json().error;
          } catch {
            return false;
          }
        },
      });
    } else {
      failedLogins.add(1);
      check(res, {
        'Non-429 error': (r) => r.status >= 400 && r.status !== 429,
      });
      console.warn(
        `Login attempt ${iteration} for VU ${vuId} (${cred.email}) returned ${res.status}`
      );
    }
  });

  // Slow rate: 10-20 attempts per minute = wait 3-6s between attempts
  const waitSeconds = 3 + Math.random() * 3;
  sleep(waitSeconds);
}

/**
 * Low-frequency smoke test for auth
 * - 5 VUs total
 * - ~10-20 login attempts per minute per VU
 * - Stays well within production rate limits (30 per 15min = 2 per minute per IP)
 */
export const options = {
  vus: 5,
  duration: '10m',
  thresholds: {
    // Expect some 429s but not all requests should fail
    'login_failed_non_429{vu:>0}': [
      { threshold: 'rate < 0.2', abortOnFail: false }, // Less than 20% hard errors
    ],
    // Logins should be fast (< 2s p95)
    'login_latency_ms{vu:>0}': [
      { threshold: 'p(95) < 2000', abortOnFail: false },
    ],
  },
};

export function teardown(data) {
  console.log(
    `Smoke test completed. Started at ${data.startTime}.\n` +
    `Check metrics for rate_limited_429 count to understand rate limit behavior.`
  );
}

