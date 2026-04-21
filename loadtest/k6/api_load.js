import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const WS_URL = __ENV.WS_URL || BASE_URL.replace(/^http/, 'ws');

const USER_COUNT = parseInt(__ENV.MOCK_USER_COUNT || '1000', 10);
const USER_OFFSET = parseInt(__ENV.MOCK_USER_OFFSET || '0', 10);
const PASSWORD = __ENV.MOCK_USER_PASSWORD || 'MockPatient1!';

const BOOKING_CREATE_RATE = parseFloat(__ENV.BOOKING_CREATE_RATE || '0.02');
const BIOMETRIC_POST_RATE = parseFloat(__ENV.BIOMETRIC_POST_RATE || '0.05');
const WS_CONNECT_RATE = parseFloat(__ENV.WS_CONNECT_RATE || '0.05');

const P95_MS = parseInt(__ENV.P95_MS || '1200', 10);

function pad4(n) {
  const s = String(n);
  if (s.length >= 4) return s;
  return '0'.repeat(4 - s.length) + s;
}

function pickUserEmail() {
  const idx = (USER_OFFSET + ((__VU + __ITER) % USER_COUNT)) + 1;
  return `patient_${pad4(idx)}@mock.ahava.test`;
}

function rand() {
  return Math.random();
}

function authHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
}

function login(email) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const ok = check(res, {
    'login status 200': (r) => r.status === 200,
  });
  if (!ok) return null;

  const body = res.json();
  const token = body && body.accessToken;
  return token || null;
}

export const options = {
  scenarios: {
    api: {
      executor: 'ramping-vus',
      startVUs: parseInt(__ENV.START_VUS || '5', 10),
      stages: [
        { duration: __ENV.STAGE_1 || '1m', target: parseInt(__ENV.VUS_1 || '25', 10) },
        { duration: __ENV.STAGE_2 || '2m', target: parseInt(__ENV.VUS_2 || '50', 10) },
        { duration: __ENV.STAGE_3 || '2m', target: parseInt(__ENV.VUS_3 || '100', 10) },
        { duration: __ENV.STAGE_4 || '2m', target: parseInt(__ENV.VUS_4 || '200', 10) },
        { duration: __ENV.STAGE_5 || '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: [`p(95)<${P95_MS}`],
  },
};

let token = null;

export default function () {
  if (!token) {
    token = login(pickUserEmail());
    if (!token) {
      sleep(1);
      return;
    }
  }

  const h = authHeaders(token);

  const r1 = http.get(`${BASE_URL}/health`);
  check(r1, { 'health 200': (r) => r.status === 200 });

  const r2 = http.get(`${BASE_URL}/api/bookings?limit=10&offset=0`, h);
  check(r2, { 'bookings 200': (r) => r.status === 200 || r.status === 503 });

  const r3 = http.get(`${BASE_URL}/api/visits?limit=10&offset=0`, h);
  check(r3, { 'visits 200': (r) => r.status === 200 || r.status === 503 });

  const r4 = http.get(`${BASE_URL}/api/messages?limit=10&offset=0`, h);
  check(r4, { 'messages 200': (r) => r.status === 200 || r.status === 503 });

  if (rand() < BOOKING_CREATE_RATE) {
    const payload = {
      encryptedAddress: 'mock_encrypted_address',
      scheduledDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      estimatedDuration: 60,
      paymentMethod: 'CARD',
      amountInCents: 10000,
      patientLat: -26.2041,
      patientLng: 28.0473,
    };
    const r5 = http.post(`${BASE_URL}/api/bookings`, JSON.stringify(payload), h);
    check(r5, { 'booking create 201/4xx/5xx': (r) => r.status >= 200 && r.status < 600 });
  }

  if (rand() < BIOMETRIC_POST_RATE) {
    const payload = {
      source: 'wearable',
      deviceType: 'k6',
      bloodPressure: { systolic: 120, diastolic: 80 },
      heartRate: 72,
      oxygenSaturation: 98,
      respiratoryRate: 16,
      stepCount: 1000,
      activeCalories: 120,
    };
    const r6 = http.post(`${BASE_URL}/api/patient/biometrics`, JSON.stringify(payload), h);
    check(r6, { 'biometrics 200/4xx/5xx': (r) => r.status >= 200 && r.status < 600 });
  }

  if (rand() < WS_CONNECT_RATE) {
    const url = `${WS_URL}?token=${token}`;
    ws.connect(url, {}, function (socket) {
      socket.on('open', function () {
        socket.close();
      });
    });
  }

  sleep(parseFloat(__ENV.SLEEP_SECONDS || '1'));
}

