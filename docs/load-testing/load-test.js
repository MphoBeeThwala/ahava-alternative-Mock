/**
 * k6 Load Testing Script for Ahava Healthcare Backend
 * 
 * Purpose: Test patient read-heavy workload at scale (health checks, auth, triage retrieval)
 * 
 * Usage:
 *   k6 run load-test.js \
 *     --vus 100 --duration 5m \
 *     -e BACKEND_URL=https://backend-production-xxx.up.railway.app \
 *     -e CREDENTIALS_FILE=./test-credentials.json
 * 
 * Rate Limiting: Login is rate-limited in production (30 attempts/15min per IP).
 * This test authenticates a pool of users once, then reuses tokens for the main test.
 * A separate smoke test (`smoke-test.js`) handles auth testing with distributed IPs.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import encoding from 'k6/encoding';
import fs from 'k6/fs';

// Read environment variables
const BACKEND_URL = __ENV.BACKEND_URL || 'http://localhost:4000';
const CREDENTIALS_FILE = __ENV.CREDENTIALS_FILE || './test-credentials.json';

// Custom metrics
const healthCheckLatency = new Trend('health_check_latency_ms');
const authMeLatency = new Trend('auth_me_latency_ms');
const triageCasesLatency = new Trend('triage_cases_latency_ms');
const errorRate = new Rate('errors');
const rateLimitedRequests = new Rate('rate_limited_429');
const serverErrorRate = new Rate('server_errors_5xx');
const p95Latency = new Trend('p95_latency_ms');
const throughput = new Counter('http_requests_total');
const activeConnections = new Gauge('active_connections');

// Load test credentials from file
let testCredentials = [];
try {
  const credentialData = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
  testCredentials = JSON.parse(credentialData);
} catch (error) {
  console.error(`Failed to load credentials from ${CREDENTIALS_FILE}: ${error}`);
  throw error;
}

if (testCredentials.length === 0) {
  throw new Error('No test credentials loaded. Run create-test-users.js first.');
}

// Global state: authenticated tokens per VU
const tokenCache = {};

/**
 * k6 lifecycle: VU initialization
 * Each VU authenticates once at the start, then reuses its token.
 */
export function setup() {
  // Validate backend connectivity
  const res = http.get(`${BACKEND_URL}/health`);
  check(res, { 'Backend is accessible': (r) => r.status === 200 });
  if (res.status !== 200) {
    throw new Error(`Backend not accessible at ${BACKEND_URL}`);
  }
  return { startTime: new Date().toISOString() };
}

/**
 * Main test function: simulates patient session
 */
export default function (setup_data) {
  const vuId = __VU; // Virtual User ID (1-based)
  const credentialIndex = (vuId - 1) % testCredentials.length;
  const cred = testCredentials[credentialIndex];

  // Authenticate on first iteration
  if (!tokenCache[vuId]) {
    group('Authentication', () => {
      const loginRes = http.post(
        `${BACKEND_URL}/api/auth/login`,
        JSON.stringify({
          email: cred.email,
          password: cred.password,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Ahava-Auth-Mode': 'json', // Get tokens in response body
          },
          timeout: '30s',
        }
      );

      if (loginRes.status === 200) {
        try {
          const body = loginRes.json();
          tokenCache[vuId] = {
            accessToken: body.accessToken,
            refreshToken: body.refreshToken,
            loginTime: new Date().toISOString(),
          };
          check(loginRes, {
            'Login successful': (r) => r.status === 200,
            'Got access token': () => !!tokenCache[vuId].accessToken,
          });
        } catch (e) {
          console.error(`VU ${vuId}: Failed to parse login response: ${e}`);
          throw e;
        }
      } else if (loginRes.status === 429) {
        rateLimitedRequests.add(1);
        check(loginRes, {
          'Rate limited is expected in auth': (r) => r.status === 429,
        });
        // Skip this VU's session if rate limited
        return;
      } else {
        console.error(
          `VU ${vuId}: Login failed with status ${loginRes.status}: ${loginRes.body}`
        );
        throw new Error(`Login failed for ${cred.email}`);
      }
    });
  }

  if (!tokenCache[vuId]) {
    return; // Skip if not authenticated
  }

  const token = tokenCache[vuId].accessToken;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': `k6-load-test/vu-${vuId}`,
  };

  activeConnections.set(Object.keys(tokenCache).length);

  // Simulate patient read-heavy workload
  group('Patient Dashboard', () => {
    // 1. Health check (lightweight baseline)
    group('GET /health', () => {
      const res = http.get(`${BACKEND_URL}/health`, {
        headers: { 'User-Agent': `k6-load-test/vu-${vuId}` },
        timeout: '10s',
      });
      
      const latency = res.timings.duration;
      healthCheckLatency.add(latency);
      throughput.add(1);
      p95Latency.add(latency);
      
      if (res.status >= 500) {
        serverErrorRate.add(1);
      }
      
      check(res, {
        'Health check 200': (r) => r.status === 200,
        'Health check < 500ms': (r) => r.timings.duration < 500,
      });
    });

    sleep(0.5); // 500ms between endpoints

    // 2. Get current user profile (requires auth)
    group('GET /api/auth/me', () => {
      const res = http.get(`${BACKEND_URL}/api/auth/me`, {
        headers,
        timeout: '15s',
      });

      const latency = res.timings.duration;
      authMeLatency.add(latency);
      throughput.add(1);
      p95Latency.add(latency);

      if (res.status === 429) {
        rateLimitedRequests.add(1);
      } else if (res.status >= 500) {
        serverErrorRate.add(1);
        errorRate.add(1);
      }

      check(res, {
        '/me returns 200': (r) => r.status === 200,
        '/me response valid': (r) => {
          if (r.status !== 200) return false;
          try {
            const body = r.json();
            return body.success && body.user && body.user.id;
          } catch {
            return false;
          }
        },
        '/me < 1s': (r) => r.timings.duration < 1000,
      });
    });

    sleep(1); // 1s between endpoints

    // 3. Get triage cases (main patient workload)
    group('GET /api/triage/my-cases', () => {
      const res = http.get(
        `${BACKEND_URL}/api/triage/my-cases?limit=20&offset=0`,
        { headers, timeout: '15s' }
      );

      const latency = res.timings.duration;
      triageCasesLatency.add(latency);
      throughput.add(1);
      p95Latency.add(latency);

      if (res.status === 429) {
        rateLimitedRequests.add(1);
      } else if (res.status >= 500) {
        serverErrorRate.add(1);
        errorRate.add(1);
      }

      check(res, {
        '/my-cases returns 2xx': (r) => r.status >= 200 && r.status < 300,
        '/my-cases response valid': (r) => {
          if (r.status < 200 || r.status >= 300) return false;
          try {
            const body = r.json();
            return body.success && Array.isArray(body.cases);
          } catch {
            return false;
          }
        },
        '/my-cases < 2s': (r) => r.timings.duration < 2000,
      });
    });

    sleep(0.5);
  });

  // Random jitter to spread requests
  sleep(Math.random() * 2);
}

/**
 * k6 lifecycle: Teardown after all VUs complete
 */
export function teardown(data) {
  console.log(`Test completed. Start time: ${data.startTime}`);
}

/**
 * k6 options: Ramping strategy
 * This configuration ramps up from 0 to 1000 VUs incrementally.
 */
export const options = {
  stages: [
    { duration: '2m', target: 25 },   // Ramp up to 25 VUs
    { duration: '3m', target: 100 },  // Ramp up to 100 VUs
    { duration: '5m', target: 250 },  // Ramp up to 250 VUs
    { duration: '5m', target: 500 },  // Ramp up to 500 VUs
    { duration: '5m', target: 1000 }, // Ramp up to 1000 VUs
    { duration: '2m', target: 0 },    // Ramp down to 0
  ],
  thresholds: {
    // Fail if 5xx error rate exceeds 2% for 60s
    'server_errors_5xx{vu:>0}': [
      { threshold: 'rate < 0.02', duration: '60s', abortOnFail: true },
    ],
    // Warn if p95 latency exceeds 3s for 2m
    'p95_latency_ms{vu:>0}': [
      { threshold: 'p(95) < 3000', duration: '2m', abortOnFail: false },
    ],
    // Overall error rate should be low
    errors: [{ threshold: 'rate < 0.05', abortOnFail: false }],
  },
  ext: {
    loadimpact: {
      // k6 Cloud config (optional)
      projectID: 0,
      name: 'Ahava Healthcare Load Test',
    },
  },
};

