const BASE = process.env.BASE_URL || 'http://localhost:4000';
const PASSWORD = process.env.MOCK_PATIENT_PASSWORD || 'MockPatient1!';

async function main() {
  const email = 'patient_0001@mock.ahava.test';
  console.log('1. Login...');
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const loginData = await loginRes.json().catch(() => ({}));
  console.log('   Status:', loginRes.status);
  console.log('   Body keys:', Object.keys(loginData));
  console.log('   accessToken present:', !!loginData.accessToken);
  if (loginData.accessToken) console.log('   token (first 50 chars):', String(loginData.accessToken).slice(0, 50) + '...');

  if (!loginRes.ok) {
    console.log('   Error:', loginData.error);
    return;
  }

  const token = loginData.accessToken || loginData.access_token;
  if (!token) {
    console.log('   No token in response');
    return;
  }

  console.log('\n2. GET /api/patient/alerts (before biometrics)...');
  const alertsRes1 = await fetch(`${BASE}/api/patient/alerts`, { headers: { Authorization: `Bearer ${token}` } });
  const alertsData1 = await alertsRes1.json().catch(() => ({}));
  console.log('   Status:', alertsRes1.status, alertsData1.error || 'ok');

  console.log('\n3. POST /api/patient/biometrics...');
  const bioRes = await fetch(`${BASE}/api/patient/biometrics`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      heartRate: 72,
      heartRateResting: 70,
      hrvRmssd: 52,
      oxygenSaturation: 98,
      respiratoryRate: 16,
      source: 'wearable',
      deviceType: 'debug_test',
    }),
  });
  const bioData = await bioRes.json().catch(() => ({}));
  console.log('   Status:', bioRes.status);
  console.log('   Body keys:', Object.keys(bioData));
  if (bioData.error) console.log('   Error:', bioData.error);
  if (bioRes.ok) console.log('   Success:', bioData.success);

  console.log('\n4. GET /api/patient/alerts (after biometrics)...');
  const alertsRes2 = await fetch(`${BASE}/api/patient/alerts`, { headers: { Authorization: `Bearer ${token}` } });
  const alertsData2 = await alertsRes2.json().catch(() => ({}));
  console.log('   Status:', alertsRes2.status, alertsData2.error || 'ok');
}

main().catch(console.error);
