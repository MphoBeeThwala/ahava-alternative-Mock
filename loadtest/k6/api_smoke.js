import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const PASSWORD = __ENV.MOCK_USER_PASSWORD || 'MockPatient1!';
const EMAIL = __ENV.MOCK_USER_EMAIL || 'patient_0001@mock.ahava.test';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_req_failed: ['rate==0'],
  },
};

export default function () {
  const r1 = http.get(`${BASE_URL}/health`);
  check(r1, { 'health 200': (r) => r.status === 200 });

  const r2 = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(r2, { 'login 200': (r) => r.status === 200 });
  const token = r2.json('accessToken');
  check({ token }, { 'token present': (v) => typeof v.token === 'string' && v.token.length > 20 });

  const h = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
  const r3 = http.get(`${BASE_URL}/api/bookings?limit=1&offset=0`, h);
  check(r3, { 'bookings 200/503': (r) => r.status === 200 || r.status === 503 });
}

