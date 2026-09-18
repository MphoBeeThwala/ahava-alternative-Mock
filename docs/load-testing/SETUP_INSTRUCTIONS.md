# Load Testing Setup Instructions

## Prerequisites

You must have a **dedicated staging database** for load testing. This guide assumes you've already set up a separate Postgres instance on Railway or locally.

### Step 1: Prepare Environment Variables

Store these as Railway secrets or in a `.env` file (not version-controlled):

```bash
# Staging backend URL (replace with actual Railway staging service URL)
STAGING_BACKEND_URL=https://backend-staging-[your-suffix].up.railway.app

# Staging database credentials (if creating users directly in DB)
STAGING_DB_HOST=shinkansen.proxy.rlwy.net
STAGING_DB_PORT=5432
STAGING_DB_USER=postgres
STAGING_DB_PASSWORD=your-password
STAGING_DB_NAME=ahava_staging
```

### Step 2: Install k6

**macOS:**
```bash
brew install k6
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6-stable.list
sudo apt-get update
sudo apt-get install -y k6
```

**Windows:**
```powershell
choco install k6
```

**Docker:**
```bash
docker pull grafana/k6:latest
```

### Step 3: Install Node Dependencies

```bash
cd docs/load-testing
npm install --save-dev @faker-js/faker
```

## Running the Test Suite

### Option A: Full Load Test (Recommended)

```bash
# 1. Create 100 synthetic patient accounts
export BACKEND_URL="https://backend-staging-xxx.up.railway.app"
node create-test-users.js \
  --count 100 \
  --backend-url "$BACKEND_URL" \
  --output test-credentials.json

# 2. Run main incremental load test (20 minutes)
k6 run load-test.js \
  -e BACKEND_URL="$BACKEND_URL" \
  -e CREDENTIALS_FILE="./test-credentials.json" \
  -o json=results.json

# 3. Analyze results
node analyze-results.js results.json
```

**Expected Duration**: ~25 minutes (user creation + load test)

### Option B: Auth Smoke Test Only

Use this to verify rate limiting behavior in isolation:

```bash
# Create test users first
node create-test-users.js --count 50 --backend-url "$BACKEND_URL"

# Run 10-minute auth test (slow: 10-20 logins/min per VU)
k6 run smoke-test.js \
  -e BACKEND_URL="$BACKEND_URL" \
  -e CREDENTIALS_FILE="./test-credentials.json" \
  --vus 5 \
  --duration 10m
```

### Option C: Quick Smoke Test (5 minutes)

For rapid validation before full test:

```bash
node create-test-users.js --count 20 --backend-url "$BACKEND_URL"

# Override stages for faster test
k6 run -c <(cat <<'EOF'
import load from './load-test.js';
export const options = {
  stages: [
    { duration: '1m', target: 25 },
    { duration: '2m', target: 100 },
    { duration: '2m', target: 0 },
  ],
};
export { default } from './load-test.js';
EOF
) \
  -e BACKEND_URL="$BACKEND_URL" \
  -e CREDENTIALS_FILE="./test-credentials.json"
```

## Interpreting Output

### During Test
k6 prints real-time metrics to stdout:
```
     vus: 250    execution: 0:05:30 / 0:20:00
  ✓ health_check_latency_ms...  avg=80.5ms min=45ms max=450ms
  ✓ auth_me_latency_ms...         avg=230ms min=120ms max=1200ms
  ✓ triage_cases_latency_ms...    avg=520ms min=180ms max=3100ms
    errors..........: 0.00%
    rate_limited_429: 0 (0.00%)
    server_errors_5xx: 0 (0.00%)
```

### After Test
k6 prints summary, then run:
```bash
node analyze-results.js results.json
```

This generates a detailed report with percentiles and saturation analysis.

## Cleanup After Testing

```bash
# Remove test credentials (they're not needed after test)
rm test-credentials.json

# Keep results for analysis
# results.json and results-report.json can be committed to tracking

# Optional: Delete test accounts from staging (manual step in DB)
```

## Troubleshooting

### "k6: command not found"
Make sure k6 is in your PATH. Test with:
```bash
k6 version
```

### "ENOENT: no such file or directory 'test-credentials.json'"
You need to create test users first:
```bash
node create-test-users.js --count 100 --backend-url "$BACKEND_URL"
```

### "Backend returned 429 (too many requests) during user creation"
The register endpoint has rate limiting. Wait a minute, then re-run.

### "All requests returning 401 (Unauthorized)"
Check that `test-credentials.json` exists and contains valid email/password pairs.

### "Connection refused"
Verify the backend URL is correct and accessible:
```bash
curl -I https://backend-staging-xxx.up.railway.app/health
```

## Next Steps

After the test completes:

1. **Review Results**
   - Check latency percentiles against SLA targets
   - Note any saturation points
   - Look for error spikes at specific VU counts

2. **Performance Optimization** (if needed)
   - Add database indexes for slow queries
   - Enable Redis caching
   - Increase replica count
   - Upgrade resource limits

3. **Validate for Production**
   - Once staging test is healthy at 1000 VUs
   - Schedule production load test with Ops team
   - Have rollback plan ready
   - Run during low-traffic window

4. **Baseline for CI/CD**
   - Consider adding to weekly scheduled tests
   - Set up GitHub Actions workflow (see README.md)
   - Archive historical results for regression detection

---

**Important**: Always run load tests on **staging only**. Never test production without explicit approval from the ops team.

