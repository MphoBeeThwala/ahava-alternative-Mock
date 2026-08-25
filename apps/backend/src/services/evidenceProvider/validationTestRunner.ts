/**
 * Validation Test Runner
 *
 * Executes all 30 validation tests and generates a comprehensive report
 * for clinical review.
 *
 * Usage:
 *   npx ts-node validationTestRunner.ts
 *   or
 *   node dist/validationTestRunner.js
 */

import { runValidationTests, generateValidationReport, getTestStatistics } from './validation';
import { getProviderRegistry, getEnabledProviders } from './registry';

async function main() {
    console.log('\n' + '='.repeat(80));
    console.log('EVIDENCE PROVIDER VALIDATION TEST RUNNER');
    console.log('='.repeat(80) + '\n');

    // Initialize and check providers
    console.log('Initializing EvidenceProvider registry...');
    const registry = getProviderRegistry();
    const enabledProviders = getEnabledProviders();

    console.log('Enabled providers: ' + enabledProviders.map(p => p.id).join(', ') + '\n');

    // Run all validation tests
    console.log('Running 30 validation tests...\n');
    const startTime = Date.now();

    const results = await runValidationTests();

    const executionTime = Date.now() - startTime;

    // Generate and display report
    console.log('\n' + '='.repeat(80));
    console.log('TEST RESULTS');
    console.log('='.repeat(80) + '\n');

    const stats = getTestStatistics(results);

    console.log('SUMMARY');
    console.log('-'.repeat(40));
    console.log('Total Tests: ' + stats.total);
    console.log('Passed: ' + stats.passed + ' (' + ((stats.passed / stats.total) * 100).toFixed(1) + '%)');
    console.log('Failed: ' + stats.failed + ' (' + ((stats.failed / stats.total) * 100).toFixed(1) + '%)');
    console.log('Execution Time: ' + executionTime + 'ms');
    console.log('Average Confidence: ' + stats.avgConfidence.toFixed(2));

    console.log('\nBY CATEGORY');
    console.log('-'.repeat(40));
    Object.entries(stats.byCategory).forEach(([category, catStats]) => {
        console.log(category + ': ' + catStats.passed + '/' + catStats.total + ' passed (' + ((catStats.passed / catStats.total) * 100).toFixed(1) + '%)');
    });

    console.log('\nBY PROVIDER');
    console.log('-'.repeat(40));
    Object.entries(stats.byProvider).forEach(([provider, provStats]) => {
        console.log(provider + ': ' + provStats.passed + '/' + provStats.total + ' passed, avg score: ' + provStats.avgScore.toFixed(2));
    });

    // Show failed tests
    if (stats.failed > 0) {
        console.log('\nFAILED TESTS');
        console.log('-'.repeat(40));
        const failedTests = results.filter(r => !r.passed);
        failedTests.forEach((test, index) => {
            console.log((index + 1) + '. [' + test.category.toUpperCase() + '] ' + test.testCaseName);
            console.log('   Error: ' + test.error);
            console.log('');
        });
    }

    // Generate full report
    console.log('\n' + '='.repeat(80));
    console.log('GENERATING FULL CLINICAL REVIEW REPORT');
    console.log('='.repeat(80) + '\n');

    const fullReport = await generateValidationReport();
    console.log(fullReport);

    // Determine overall status
    console.log('\n' + '='.repeat(80));
    console.log('OVERALL STATUS');
    console.log('='.repeat(80) + '\n');

    if (stats.passed === stats.total) {
        console.log('[PASS] ALL TESTS PASSED');
        console.log('The EvidenceProvider module is ready for clinical review.');
    } else if (stats.passed >= stats.total * 0.9) {
        console.log('[PASS] MOST TESTS PASSED (' + ((stats.passed / stats.total) * 100).toFixed(1) + '%)');
        console.log('The EvidenceProvider module is mostly functional.');
        console.log('Review failed tests for potential improvements.');
    } else if (stats.passed >= stats.total * 0.7) {
        console.log('[WARN] SOME TESTS FAILED (' + ((stats.passed / stats.total) * 100).toFixed(1) + '%)');
        console.log('The EvidenceProvider module needs attention.');
        console.log('Multiple providers may be failing or returning low-confidence results.');
    } else {
        console.log('[FAIL] MOST TESTS FAILED (' + ((stats.passed / stats.total) * 100).toFixed(1) + '%)');
        console.log('The EvidenceProvider module has significant issues.');
        console.log('Check provider configurations and network connectivity.');
    }

    console.log('\n' + '='.repeat(80) + '\n');

    return {
        results,
        stats,
        fullReport,
        executionTime,
    };
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Error running validation tests:', error);
        process.exit(1);
    });
}

export { main };
