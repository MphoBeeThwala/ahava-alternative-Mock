/**
 * k6 Results Analyzer
 * 
 * Parses k6 JSON output and generates a human-readable summary report
 * 
 * Usage:
 *   k6 run load-test.js -o json=results.json
 *   node analyze-results.js results.json
 */

const fs = require('fs');
const path = require('path');

function analyzeResults(jsonFile) {
  console.log(`Analyzing k6 results from: ${jsonFile}\n`);

  // Read and parse k6 output
  const lines = fs.readFileSync(jsonFile, 'utf-8').split('\n').filter(l => l.trim());
  
  // Collect metrics
  const metrics = {};
  const errorsByStatus = {};
  let maxVUs = 0;

  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    
    try {
      const entry = JSON.parse(line);
      
      if (entry.type === 'Point') {
        const { metric, data } = entry;
        if (!metrics[metric]) {
          metrics[metric] = [];
        }
        metrics[metric].push(data.value);
        
        // Track VUs
        if (data.tags?.vu) {
          maxVUs = Math.max(maxVUs, parseInt(data.tags.vu, 10));
        }
        
        // Track error statuses
        if (data.tags?.status && data.tags.status >= 400) {
          const status = data.tags.status;
          if (!errorsByStatus[status]) {
            errorsByStatus[status] = 0;
          }
          errorsByStatus[status]++;
        }
      }
    } catch {
      // Skip invalid lines
    }
  }

  // Calculate percentiles
  const percentile = (arr, p) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  };

  // Compile report
  const report = {
    timestamp: new Date().toISOString(),
    testDuration: '20m (2m + 3m + 5m + 5m + 5m)',
    maxConcurrentVUs: maxVUs,
    testType: 'Incremental Load Test (Patient Read-Heavy Workload)',
    
    healthCheckMetrics: {
      p50: Math.round(percentile(metrics['health_check_latency_ms'] || [], 50)),
      p95: Math.round(percentile(metrics['health_check_latency_ms'] || [], 95)),
      p99: Math.round(percentile(metrics['health_check_latency_ms'] || [], 99)),
      count: (metrics['health_check_latency_ms'] || []).length,
    },
    
    authMeMetrics: {
      p50: Math.round(percentile(metrics['auth_me_latency_ms'] || [], 50)),
      p95: Math.round(percentile(metrics['auth_me_latency_ms'] || [], 95)),
      p99: Math.round(percentile(metrics['auth_me_latency_ms'] || [], 99)),
      count: (metrics['auth_me_latency_ms'] || []).length,
    },
    
    triageCasesMetrics: {
      p50: Math.round(percentile(metrics['triage_cases_latency_ms'] || [], 50)),
      p95: Math.round(percentile(metrics['triage_cases_latency_ms'] || [], 95)),
      p99: Math.round(percentile(metrics['triage_cases_latency_ms'] || [], 99)),
      count: (metrics['triage_cases_latency_ms'] || []).length,
    },
    
    throughput: {
      totalRequests: (metrics['http_requests_total'] || []).reduce((a, b) => a + b, 0),
      rateLimited429: (metrics['rate_limited_429'] || []).filter(v => v > 0).length,
      serverErrors5xx: (metrics['server_errors_5xx'] || []).filter(v => v > 0).length,
      overallErrorRate: (metrics['errors'] || []).reduce((a, b) => a + b, 0) / Math.max(1, (metrics['errors'] || []).length),
    },
    
    errorsByHttpStatus: errorsByStatus,
    
    saturationPoint: determineSaturationPoint(metrics),
  };

  // Print formatted report
  printReport(report);
  
  // Save report to file
  const reportFile = jsonFile.replace('.json', '-report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n[✓] Detailed report saved to: ${reportFile}`);
  
  return report;
}

function determineSaturationPoint(metrics) {
  const latencies = metrics['auth_me_latency_ms'] || [];
  const errorRates = metrics['server_errors_5xx'] || [];
  
  if (latencies.length < 100) {
    return { found: false, note: 'Insufficient data to determine saturation' };
  }
  
  // Find where p95 latency crosses 2s or error rate crosses 2%
  const threshold = 2000;
  const crossover = latencies.findIndex(l => l > threshold);
  
  if (crossover >= 0) {
    const vusAtCrossover = Math.round((crossover / latencies.length) * 1000); // Estimate
    return {
      found: true,
      estimatedAtVUs: vusAtCrossover,
      metric: 'p95_latency',
      threshold: `${threshold}ms`,
    };
  }
  
  return { found: false, note: 'System did not saturate within test range' };
}

function printReport(report) {
  console.log('\n' + '='.repeat(70));
  console.log('AHAVA HEALTHCARE - LOAD TEST RESULTS');
  console.log('='.repeat(70));
  console.log(`Test Started: ${report.timestamp}`);
  console.log(`Test Duration: ${report.testDuration}`);
  console.log(`Peak Concurrent VUs: ${report.maxConcurrentVUs}`);
  console.log(`Workload Type: ${report.testType}\n`);

  console.log('ENDPOINT LATENCY METRICS (ms)');
  console.log('-'.repeat(70));
  
  console.log('GET /health:');
  console.log(`  p50: ${report.healthCheckMetrics.p50}ms | p95: ${report.healthCheckMetrics.p95}ms | p99: ${report.healthCheckMetrics.p99}ms`);
  console.log(`  Total Requests: ${report.healthCheckMetrics.count}\n`);
  
  console.log('GET /api/auth/me:');
  console.log(`  p50: ${report.authMeMetrics.p50}ms | p95: ${report.authMeMetrics.p95}ms | p99: ${report.authMeMetrics.p99}ms`);
  console.log(`  Total Requests: ${report.authMeMetrics.count}\n`);
  
  console.log('GET /api/triage/my-cases:');
  console.log(`  p50: ${report.triageCasesMetrics.p50}ms | p95: ${report.triageCasesMetrics.p95}ms | p99: ${report.triageCasesMetrics.p99}ms`);
  console.log(`  Total Requests: ${report.triageCasesMetrics.count}\n`);

  console.log('THROUGHPUT & ERRORS');
  console.log('-'.repeat(70));
  console.log(`Total HTTP Requests: ${report.throughput.totalRequests}`);
  console.log(`Rate Limited (429): ${report.throughput.rateLimited429}`);
  console.log(`Server Errors (5xx): ${report.throughput.serverErrors5xx}`);
  console.log(`Overall Error Rate: ${(report.throughput.overallErrorRate * 100).toFixed(2)}%\n`);

  if (Object.keys(report.errorsByHttpStatus).length > 0) {
    console.log('Errors by Status Code:');
    for (const [status, count] of Object.entries(report.errorsByHttpStatus)) {
      console.log(`  ${status}: ${count}`);
    }
    console.log();
  }

  console.log('SATURATION ANALYSIS');
  console.log('-'.repeat(70));
  if (report.saturationPoint.found) {
    console.log(`Saturation Point: ~${report.saturationPoint.estimatedAtVUs} VUs`);
    console.log(`Metric: ${report.saturationPoint.metric} exceeds ${report.saturationPoint.threshold}`);
  } else {
    console.log(`Status: ${report.saturationPoint.note}`);
  }
  console.log();

  console.log('RECOMMENDATIONS');
  console.log('-'.repeat(70));
  console.log('• Review endpoint latencies above — use p95/p99 for SLA targets');
  console.log('• Check server error rate — aim for < 0.1% on read endpoints');
  console.log('• If saturation found, consider: caching, connection pooling, replicas');
  console.log('• Next steps: Test at higher VU count if all metrics are healthy');
  console.log();
  console.log('='.repeat(70));
}

// Main
if (require.main === module) {
  const resultsFile = process.argv[2];
  if (!resultsFile || !fs.existsSync(resultsFile)) {
    console.error('Usage: node analyze-results.js <k6-json-output-file>');
    process.exit(1);
  }
  
  analyzeResults(resultsFile);
}

module.exports = { analyzeResults };

