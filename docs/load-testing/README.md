# Load Testing Guide for Ahava Healthcare Backend

This directory contains scripts and configuration for comprehensive load testing of the Backend API at scale, with a focus on patient read-heavy workflows.

## Overview

- **Target**: Patient-heavy read-only operations (health checks, auth, triage retrieval)
- **Scale**: Incremental ramp from 25 to 1,000 concurrent virtual users
- **Test Type**: Non-destructive (no write operations, no external API calls)
- **Duration**: 20 minutes total test execution
- **Rate Limiting**: Auth tests run separately on staging to avoid production rate limits

## Files

| File | Purpose |
|------|---------|
| `load-test.js` | Main k6 script: incremental load test (25→100→250→500→1000 VUs) |
| `smoke-test.js` | Authentication smoke test: login rate limiting verification |
| `create-test-users.js` | Generate 100+ synthetic patient accounts (non-real data) |
| `analyze-results.js` | Parse k6 JSON output and generate human-readable report |
| `README.md` | This file |

## Prerequisites

### System Requirements
- **k6**: v0.47+ ([install](https://k6.io/docs/getting-started/installation/))
- **Node.js**: v16+ (for utility scripts)
- **Internet Access**: To reach the Backend URL

### Dependencies
```bash
npm install --save-dev @faker-js/faker
```

### Backend Requirements
- Backend service must be accessible (no authentication required for `/health`)
- Staging database with separate credentials (do NOT use production)
- Load test credentials stored as Railway secrets (not in code)

## Quick Start

### 1. Create Test Credentials (Staging Only)

```bash
# Set your staging backend URL
export BACKEND_URL="https://backend-staging-xxx.up.railway.app"
export OUTPUT_FILE="./test-credentials.json"

# Generate 100 synthetic test patient accounts
node create-test-users.js \
  --count 100 \
  --backend-url "$BACKEND_URL" \
  --output "$OUTPUT_FILE"
```

This script:
- Creates 100 PATIENT accounts with synthetic data (@test.local emails)
- Generates strong passwords (8+ chars, uppercase, digits, special chars)
- Saves credentials to `test-credentials.json` (keep this file secure)
- Does NOT print passwords to stdout or logs

### 2. Run Main Load Test

```bash
# Export to JSON for analysis
k6 run load-test.js \
  -e BACKEND_URL="$BACKEND_URL" \
  -e CREDENTIALS_FILE="./test-credentials.json" \
  -o json=results.json
```

**Test Schedule** (20 minutes total):
- **0-2m**: Ramp up to 25 VUs
- **2-5m**: Ramp up to 100 VUs
- **5-10m**: Ramp up to 250 VUs
- **10-15m**: Ramp up to 500 VUs
- **15-20m**: Ramp up to 1,000 VUs
- **20-22m**: Ramp down to 0 VUs

**What It Tests** (per VU):
```
GET  /health                 (health check, no auth)
GET  /api/auth/me            (requires Bearer token)
GET  /api/triage/my-cases    (requires Bearer token)
```

Endpoints are called sequentially with realistic think time (0.5-2s between requests).

### 3. Run Auth Smoke Test (Separate, Staging Only)

```bash
# Slow login rate test: 10-20 attempts per minute per VU
# Distributed across 5 VUs to spread load
k6 run smoke-test.js \
  -e BACKEND_URL="$BACKEND_URL" \
  -e CREDENTIALS_FILE="./test-credentials.json" \
  --vus 5 \
  --duration 10m
```

This test:
- Uses distinct test users (rounds through credential pool)
- Waits 3-6s between login attempts
- Tracks 429 rate-limit responses separately from errors
- Validates rate limiting behavior is correct

### 4. Analyze Results

```bash
# Generate human-readable report
node analyze-results.js results.json
```

Output:
- Latency percentiles (p50, p95, p99) per endpoint
- Throughput (requests/sec)
- Error rates by HTTP status
- Saturation point estimate
- Recommendations

## Important: Security & Staging Only

⚠️ **CRITICAL**: This test **MUST** run on a dedicated **staging database**, never production.

### Why?
1. **Rate Limiting**: Production login is rate-limited at 30 attempts/15 min per IP
   - Main test authenticates once per VU (no repeated login attempts)
   - Auth smoke test runs separately on staging with slow requests
2. **Data Isolation**: Test users are synthetic with @test.local emails
3. **Load Impact**: 1,000 concurrent users will saturate the production database

### How to Verify

```bash
# Before running, verify backend is staging:
curl -s https://backend-staging-xxx.up.railway.app/health | jq .

# Confirm environment:
echo "Backend URL: $BACKEND_URL"
```

## Test Credentials Security

⚠️ **DO NOT:**
- Commit `test-credentials.json` to version control
- Print passwords in logs
- Reuse test credentials in other tests
- Store credentials in plaintext config files

✅ **DO:**
- Store file path in `.gitignore`
- Regenerate credentials between test runs
- Use Railway secrets for any long-lived credentials
- Delete `test-credentials.json` after testing

## Metrics & Thresholds

### Pass Criteria
| Metric | Threshold | Explanation |
|--------|-----------|-------------|
| Server Error Rate (5xx) | < 2% for 60s | If exceeded, test aborts |
| p95 Latency | < 3s for 2m | Warnings if exceeded (not aborted) |
| Overall Error Rate | < 5% | Non-critical warning |

### Key Metrics to Track
- **p50/p95/p99 Latency**: Median and tail latencies per endpoint
- **Throughput**: Total requests and requests per second
- **Error Rate**: By HTTP status (5xx, 429, 4xx)
- **Saturation Point**: Where latency or errors spike significantly

## Interpreting Results

### Healthy Baseline
```
GET /health:
  p50: 50ms | p95: 150ms | p99: 300ms

GET /api/auth/me:
  p50: 200ms | p95: 800ms | p99: 1500ms

GET /api/triage/my-cases:
  p50: 400ms | p95: 1500ms | p99: 2500ms

Error Rate: < 0.1%
Saturation: Not found (tested up to 1000 VUs)
```

### Signs of Saturation
- **High Latency**: p95 > 2s, p99 > 5s
- **Error Spike**: Error rate > 2% at specific VU count
- **Timeout**: Client timeouts (408, 504)
- **Connection Errors**: TCP resets, connection refused

### Next Steps if Saturation Found
1. **Identify bottleneck**: CPU? Memory? Database connections?
2. **Check resource usage**: CPU/memory metrics from Railway dashboard
3. **Review slow queries**: Database logs for slow triage queries
4. **Consider optimizations**:
   - Add database indexes
   - Enable query caching (Redis)
   - Increase replica count
   - Upgrade resource limits

## Running on CI/CD

Example GitHub Actions workflow:

```yaml
name: Load Test

on:
  schedule:
    - cron: '0 2 * * 0' # Weekly on Sunday 2 AM UTC
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup k6
        run: |
          sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6-stable.list
          sudo apt-get update
          sudo apt-get install -y k6
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install --save-dev @faker-js/faker
      
      - name: Create test users
        env:
          BACKEND_URL: ${{ secrets.STAGING_BACKEND_URL }}
        run: |
          node docs/load-testing/create-test-users.js \
            --count 100 \
            --backend-url "$BACKEND_URL" \
            --output test-credentials.json
      
      - name: Run load test
        env:
          BACKEND_URL: ${{ secrets.STAGING_BACKEND_URL }}
        run: |
          k6 run docs/load-testing/load-test.js \
            -e BACKEND_URL="$BACKEND_URL" \
            -e CREDENTIALS_FILE="test-credentials.json" \
            -o json=results.json
      
      - name: Analyze results
        run: node docs/load-testing/analyze-results.js results.json
      
      - name: Upload results
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: load-test-results
          path: |
            results.json
            results-report.json
```

## Troubleshooting

### "Backend not accessible"
```bash
# Verify URL and network
curl -v https://backend-staging-xxx.up.railway.app/health
```

### "Rate limited during user creation"
- The `/api/auth/register` endpoint has a rate limiter
- Reduce `--count` or wait before retrying

### "Most requests failing with 401"
- Check that credentials file was created successfully
- Verify tokens are being parsed correctly
- Check Bearer token format in logs

### "High latency at certain VU count"
- Note the VU count where latency spikes
- That's your saturation point
- Investigate database/CPU metrics at that moment

### k6 not found
```bash
# Install k6 (macOS)
brew install k6

# Or use Docker
docker run -it --rm -v $(pwd):/workspace grafana/k6:latest \
  run /workspace/docs/load-testing/load-test.js
```

## FAQ

**Q: Can I run this against production?**
A: No. The test creates accounts, authenticates repeatedly, and would trigger rate limits. Always use staging.

**Q: How many test users do I need?**
A: 100 is sufficient for 1,000 VUs (reuse pool). For higher loads, generate 200+.

**Q: Why does the test authenticate only once per VU?**
A: Production has auth rate limits (30 logins/15min). The main test reuses tokens. Auth testing is a separate smoke test.

**Q: Can I test write operations (create triage case)?**
A: Not in this script. Write tests would require careful data cleanup and are out of scope for a baseline capacity test.

**Q: How do I increase to 5,000 VUs?**
A: Modify the `stages` array in `load-test.js` to add higher ramp targets. Note: you may exceed database connection limits.

## References

- [k6 Documentation](https://k6.io/docs/)
- [k6 Thresholds](https://k6.io/docs/using-k6/thresholds/)
- [k6 Results Output](https://k6.io/docs/results-output/)
- [Backend API Routes](../routes/)
- [Railway Performance Guide](https://docs.railway.com/guides/performance)

---

**Last Updated**: 2026-09-18
**Test Version**: 1.0
**Maintained By**: Engineering Team

