# Load Testing

This repository includes a k6 load test suite designed to model real platform usage: logins, browsing bookings/visits/messages, occasional bookings, occasional biometric uploads, and intermittent WebSocket connects.

## Prerequisites

- Backend running with a real Postgres database
- `JWT_SECRET` set on the backend (required for login and WebSockets)
- For cross-instance WebSocket fanout tests: `REDIS_URL` set and Redis available
- Test users seeded via the built-in seed script

## Seed Users

Create mock patients (default 1000):

```powershell
pnpm seed:mock-patients
```

Optional:

```powershell
$env:MOCK_PATIENT_COUNT=5000
$env:MOCK_PATIENT_PASSWORD="MockPatient1!"
pnpm seed:mock-patients
```

Users are created as:

- `patient_0001@mock.ahava.test` … `patient_1000@mock.ahava.test`

## Install k6

Use one of:

- https://k6.io/docs/get-started/installation/
- Docker: `grafana/k6`

## Smoke Test

```powershell
$env:BASE_URL="http://localhost:4000"
$env:MOCK_USER_EMAIL="patient_0001@mock.ahava.test"
$env:MOCK_USER_PASSWORD="MockPatient1!"
k6 run loadtest/k6/api_smoke.js
```

## Load Test (Ramp)

```powershell
$env:BASE_URL="http://localhost:4000"
$env:WS_URL="ws://localhost:4000"
$env:MOCK_USER_COUNT="1000"
$env:MOCK_USER_PASSWORD="MockPatient1!"
$env:P95_MS="1200"
k6 run loadtest/k6/api_load.js
```

### Common Tunables

- `START_VUS` (default 5)
- `VUS_1..VUS_4` and `STAGE_1..STAGE_5` to control ramping
- `BOOKING_CREATE_RATE` (default 0.02) fraction of iterations that create a booking
- `BIOMETRIC_POST_RATE` (default 0.05) fraction of iterations that POST biometrics
- `WS_CONNECT_RATE` (default 0.05) fraction of iterations that connect WebSocket
- `SLEEP_SECONDS` (default 1) pacing between iterations

### Suggested “industry standard” pass/fail gates

- `http_req_failed < 1%`
- `p95(http_req_duration) < 1200ms` (adjust per environment)

## Notes

- Run against a staging environment configured like production (same DB sizing, Redis enabled, same instance count) for meaningful results.
- For write-heavy tests, start with a smaller `BOOKING_CREATE_RATE` and increase gradually to avoid filling the database too quickly.

