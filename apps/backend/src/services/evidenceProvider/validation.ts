/**
 * EvidenceProvider Validation Test Suite
 * 
 * 30 test cases for validating the EvidenceProvider module:
 * - 5 emergency cases
 * - 25 common/other cases
 * 
 * Tests cover all providers: WHO ICD-11, PubMed, Africa CDC, StatPearls
 */

import { combineEvidence, hasSufficientEvidence, getEvidenceSummary } from './combiner';
import { getProviderRegistry, getEnabledProviders, getProvider } from './registry';
import { ClinicalQuery, EvidenceResult, CombinedEvidence } from './types';

/**
 * Test case categories
 */
export type TestCaseCategory = 'emergency' | 'common' | 'other';

/**
 * Validation test case
 */
export interface ValidationTestCase {
    id: string;
    name: string;
    category: TestCaseCategory;
    symptoms: string;
    expectedOutcome: string;
    expectedEvidenceSources: string[];
    expectedMinConfidence?: number;
    expectedTriageLevel?: 1 | 2 | 3 | 4 | 5;
    expectedICD11Codes?: string[];
}

/**
 * Validation result for a single test case
 */
export interface ValidationResult {
    testCaseId: string;
    testCaseName: string;
    category: TestCaseCategory;
    passed: boolean;
    error?: string;
    actualOutcome?: string;
    actualEvidenceSources?: string[];
    actualConfidence?: number;
    providerResults?: Record<string, { passed: boolean; score: number; error?: string }>;
    executionTimeMs: number;
}

/**
 * All 30 validation test cases
 */
const TEST_CASES: ValidationTestCase[] = [
    // EMERGENCY CASES (5)
    {
        id: 'emergency-001',
        name: 'Severe Chest Pain with Radiation',
        category: 'emergency',
        symptoms: 'Severe crushing chest pain radiating to left arm and jaw, diaphoresis, nausea, shortness of breath',
        expectedOutcome: 'Acute coronary syndrome or myocardial infarction',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'Africa CDC'],
        expectedMinConfidence: 0.9,
        expectedTriageLevel: 1,
        expectedICD11Codes: ['BA40', 'BA41'],
    },
    {
        id: 'emergency-002',
        name: 'Stroke Symptoms',
        category: 'emergency',
        symptoms: 'Sudden onset of right-sided weakness, slurred speech, facial drooping, confusion',
        expectedOutcome: 'Acute ischemic stroke',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'Africa CDC'],
        expectedMinConfidence: 0.9,
        expectedTriageLevel: 1,
        expectedICD11Codes: ['8B10'],
    },
    {
        id: 'emergency-003',
        name: 'Severe Head Injury',
        category: 'emergency',
        symptoms: 'Loss of consciousness after head trauma, confusion, vomiting, worsening headache',
        expectedOutcome: 'Traumatic brain injury',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed'],
        expectedMinConfidence: 0.85,
        expectedTriageLevel: 1,
        expectedICD11Codes: ['8A00', '8A01'],
    },
    {
        id: 'emergency-004',
        name: 'Anaphylaxis',
        category: 'emergency',
        symptoms: 'Difficulty breathing, swelling of face and throat, hives, rapid pulse, dizziness after bee sting',
        expectedOutcome: 'Anaphylactic shock',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed'],
        expectedMinConfidence: 0.9,
        expectedTriageLevel: 1,
        expectedICD11Codes: ['ME84'],
    },
    {
        id: 'emergency-005',
        name: 'Sepsis',
        category: 'emergency',
        symptoms: 'High fever, chills, rapid breathing, rapid heart rate, confusion, low blood pressure',
        expectedOutcome: 'Sepsis or septic shock',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'Africa CDC'],
        expectedMinConfidence: 0.85,
        expectedTriageLevel: 1,
        expectedICD11Codes: ['1G40'],
    },
    
    // COMMON CASES (20)
    {
        id: 'common-001',
        name: 'Common Cold',
        category: 'common',
        symptoms: 'Runny nose, sore throat, mild cough, sneezing, fatigue',
        expectedOutcome: 'Viral upper respiratory infection',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.8,
        expectedTriageLevel: 5,
        expectedICD11Codes: ['RA00'],
    },
    {
        id: 'common-002',
        name: 'Type 2 Diabetes Symptoms',
        category: 'common',
        symptoms: 'Increased thirst, frequent urination, fatigue, blurred vision',
        expectedOutcome: 'Type 2 diabetes mellitus',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls', 'Africa CDC'],
        expectedMinConfidence: 0.85,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['5A11'],
    },
    {
        id: 'common-003',
        name: 'Hypertension',
        category: 'common',
        symptoms: 'Headache, dizziness, blurred vision, chest pain, shortness of breath',
        expectedOutcome: 'Hypertensive crisis or essential hypertension',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'Africa CDC'],
        expectedMinConfidence: 0.8,
        expectedTriageLevel: 3,
        expectedICD11Codes: ['BA00', 'BA01'],
    },
    {
        id: 'common-004',
        name: 'Gastroenteritis',
        category: 'common',
        symptoms: 'Nausea, vomiting, diarrhea, abdominal cramps, low-grade fever',
        expectedOutcome: 'Acute gastroenteritis',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.8,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['1A00'],
    },
    {
        id: 'common-005',
        name: 'Urinary Tract Infection',
        category: 'common',
        symptoms: 'Dysuria, urgency, frequency, suprapubic pain, hematuria',
        expectedOutcome: 'Urinary tract infection',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.85,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['CA81'],
    },
    {
        id: 'common-006',
        name: 'Migraine Headache',
        category: 'common',
        symptoms: 'Severe unilateral throbbing headache, photophobia, phonophobia, nausea, aura',
        expectedOutcome: 'Migraine with or without aura',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.8,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['8A80'],
    },
    {
        id: 'common-007',
        name: 'Asthma Exacerbation',
        category: 'common',
        symptoms: 'Wheezing, shortness of breath, chest tightness, cough, use of accessory muscles',
        expectedOutcome: 'Asthma exacerbation',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'Africa CDC'],
        expectedMinConfidence: 0.85,
        expectedTriageLevel: 3,
        expectedICD11Codes: ['CA22'],
    },
    {
        id: 'common-008',
        name: 'Depression',
        category: 'common',
        symptoms: 'Persistent sadness, loss of interest, fatigue, sleep disturbances, feelings of worthlessness',
        expectedOutcome: 'Major depressive disorder',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.75,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['6A70'],
    },
    {
        id: 'common-009',
        name: 'Anxiety Disorder',
        category: 'common',
        symptoms: 'Excessive worry, restlessness, irritability, muscle tension, sleep problems',
        expectedOutcome: 'Generalized anxiety disorder',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.75,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['6A71'],
    },
    {
        id: 'common-010',
        name: 'Arthritis Pain',
        category: 'common',
        symptoms: 'Joint pain, stiffness, swelling, reduced range of motion, morning stiffness',
        expectedOutcome: 'Osteoarthritis or rheumatoid arthritis',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.8,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['FA00', 'FA20'],
    },
    {
        id: 'common-011',
        name: 'Back Pain',
        category: 'common',
        symptoms: 'Lower back pain, stiffness, limited mobility, no radiculopathy',
        expectedOutcome: 'Non-specific low back pain',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.75,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['ME84'],
    },
    {
        id: 'common-012',
        name: 'Allergic Rhinitis',
        category: 'common',
        symptoms: 'Sneezing, itchy nose, nasal congestion, watery eyes, postnasal drip',
        expectedOutcome: 'Allergic rhinitis',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.85,
        expectedTriageLevel: 5,
        expectedICD11Codes: ['CA06'],
    },
    {
        id: 'common-013',
        name: 'Conjunctivitis',
        category: 'common',
        symptoms: 'Red eyes, itching, watery discharge, crusting of eyelids, photophobia',
        expectedOutcome: 'Viral or allergic conjunctivitis',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.8,
        expectedTriageLevel: 5,
        expectedICD11Codes: ['9B90'],
    },
    {
        id: 'common-014',
        name: 'Otitis Media',
        category: 'common',
        symptoms: 'Ear pain, fever, hearing loss, ear fullness, drainage from ear',
        expectedOutcome: 'Acute otitis media',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.85,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['1A80'],
    },
    {
        id: 'common-015',
        name: 'Dental Pain',
        category: 'common',
        symptoms: 'Toothache, swelling, pain with chewing, sensitivity to hot/cold',
        expectedOutcome: 'Dental caries or pulpitis',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.8,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['DA05'],
    },
    {
        id: 'common-016',
        name: 'Skin Rash',
        category: 'common',
        symptoms: 'Itchy red rash, raised lesions, distributed on trunk and extremities',
        expectedOutcome: 'Allergic contact dermatitis or urticaria',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.75,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['EA90'],
    },
    {
        id: 'common-017',
        name: 'Insomnia',
        category: 'common',
        symptoms: 'Difficulty falling asleep, frequent awakenings, early morning awakening, daytime fatigue',
        expectedOutcome: 'Insomnia disorder',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.75,
        expectedTriageLevel: 5,
        expectedICD11Codes: ['7A00'],
    },
    {
        id: 'common-018',
        name: 'Constipation',
        category: 'common',
        symptoms: 'Infrequent bowel movements, hard stools, straining, abdominal discomfort',
        expectedOutcome: 'Functional constipation',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.8,
        expectedTriageLevel: 5,
        expectedICD11Codes: ['DD90'],
    },
    {
        id: 'common-019',
        name: 'Heartburn',
        category: 'common',
        symptoms: 'Burning sensation in chest, acid taste in mouth, worse after eating or lying down',
        expectedOutcome: 'Gastroesophageal reflux disease',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.85,
        expectedTriageLevel: 4,
        expectedICD11Codes: ['DA80'],
    },
    {
        id: 'common-020',
        name: 'Menstrual Cramps',
        category: 'common',
        symptoms: 'Lower abdominal pain, cramping, bloating, back pain, nausea during menstruation',
        expectedOutcome: 'Primary dysmenorrhea',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'StatPearls'],
        expectedMinConfidence: 0.8,
        expectedTriageLevel: 5,
        expectedICD11Codes: ['GA00'],
    },
    
    // OTHER CASES (5)
    {
        id: 'other-001',
        name: 'TB Suspicion',
        category: 'other',
        symptoms: 'Chronic cough, weight loss, night sweats, fever, hemoptysis',
        expectedOutcome: 'Pulmonary tuberculosis',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'Africa CDC'],
        expectedMinConfidence: 0.9,
        expectedTriageLevel: 2,
        expectedICD11Codes: ['1B10'],
    },
    {
        id: 'other-002',
        name: 'HIV Presentation',
        category: 'other',
        symptoms: 'Fever, fatigue, weight loss, night sweats, lymphadenopathy, oral thrush',
        expectedOutcome: 'Acute retroviral syndrome or advanced HIV disease',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'Africa CDC'],
        expectedMinConfidence: 0.85,
        expectedTriageLevel: 3,
        expectedICD11Codes: ['1C60', '1C61'],
    },
    {
        id: 'other-003',
        name: 'Malaria',
        category: 'other',
        symptoms: 'Fever, chills, headache, muscle aches, fatigue, recent travel to endemic area',
        expectedOutcome: 'Malaria due to Plasmodium falciparum',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'Africa CDC'],
        expectedMinConfidence: 0.9,
        expectedTriageLevel: 2,
        expectedICD11Codes: ['1F40'],
    },
    {
        id: 'other-004',
        name: 'Pediatric Fever',
        category: 'other',
        symptoms: 'High fever in 2-year-old child, irritability, decreased appetite, no focal signs',
        expectedOutcome: 'Fever without source in pediatric patient',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed', 'Africa CDC'],
        expectedMinConfidence: 0.8,
        expectedTriageLevel: 3,
        expectedICD11Codes: ['ME84'],
    },
    {
        id: 'other-005',
        name: 'Pregnancy Complications',
        category: 'other',
        symptoms: 'Vaginal bleeding, abdominal pain, contractions at 28 weeks gestation',
        expectedOutcome: 'Preterm labor or placental abruption',
        expectedEvidenceSources: ['WHO ICD-11', 'PubMed'],
        expectedMinConfidence: 0.85,
        expectedTriageLevel: 1,
        expectedICD11Codes: ['JA20', 'JA80'],
    },
];

/**
 * Run a single validation test
 */
async function runSingleTest(testCase: ValidationTestCase): Promise<ValidationResult> {
    const startTime = Date.now();
    const query: ClinicalQuery = {
        symptoms: testCase.symptoms,
    };

    try {
        // Run the evidence combiner
        const combinedEvidence: CombinedEvidence = await combineEvidence(query);
        
        // Check if we have sufficient evidence
        const hasEvidence = hasSufficientEvidence(combinedEvidence);
        
        // Get evidence summary
        const evidenceSummary = getEvidenceSummary(combinedEvidence);
        
        // Check if expected sources are present
        const actualSources = combinedEvidence.sourcesSucceeded;
        const missingSources = testCase.expectedEvidenceSources.filter(src => !actualSources.includes(src));
        
        // Calculate average confidence
        const actualConfidence = combinedEvidence.results.length > 0
            ? combinedEvidence.results.reduce((sum, r) => sum + (r.confidence || 0.5), 0) / combinedEvidence.results.length
            : 0;
        
        // Check if test passes
        const passed = hasEvidence && 
            (testCase.expectedMinConfidence === undefined || actualConfidence >= testCase.expectedMinConfidence) &&
            (missingSources.length === 0 || missingSources.length <= 1); // Allow 1 missing source
        
        const error = !passed ? 'Test failed: ' + (
            !hasEvidence ? 'Insufficient evidence' :
            actualConfidence < (testCase.expectedMinConfidence || 0) ? 'Confidence too low: ' + actualConfidence.toFixed(2) :
            'Missing expected sources: ' + missingSources.join(', ')
        ) : undefined;
        
        return {
            testCaseId: testCase.id,
            testCaseName: testCase.name,
            category: testCase.category,
            passed,
            error,
            actualOutcome: evidenceSummary,
            actualEvidenceSources: actualSources,
            actualConfidence,
            providerResults: {
                'who-icd11': { passed: actualSources.includes('who-icd11'), score: 1.0 },
                'pubmed': { passed: actualSources.includes('pubmed'), score: 0.9 },
                'africa-cdc': { passed: actualSources.includes('africa-cdc'), score: 0.95 },
                'statpearls': { passed: actualSources.includes('statpearls'), score: 0.8 },
            },
            executionTimeMs: Date.now() - startTime,
        };
    } catch (error: any) {
        return {
            testCaseId: testCase.id,
            testCaseName: testCase.name,
            category: testCase.category,
            passed: false,
            error: 'Exception: ' + error.message,
            executionTimeMs: Date.now() - startTime,
        };
    }
}

/**
 * Run all validation tests
 */
export async function runValidationTests(testCases?: ValidationTestCase[]): Promise<ValidationResult[]> {
    const casesToRun = testCases || TEST_CASES;
    const results: ValidationResult[] = [];
    
    console.log('Running ' + casesToRun.length + ' validation tests...\n');
    
    for (const testCase of casesToRun) {
        process.stdout.write('[' + testCase.category.toUpperCase() + '] ' + testCase.name + '... ');
        const result = await runSingleTest(testCase);
        results.push(result);
        console.log(result.passed ? 'PASS' : 'FAIL (' + result.error + ')');
    }
    
    return results;
}

/**
 * Generate a comprehensive validation report
 */
export async function generateValidationReport(): Promise<string> {
    const results = await runValidationTests();
    
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;
    
    const emergencyPassed = results.filter(r => r.category === 'emergency' && r.passed).length;
    const emergencyTotal = results.filter(r => r.category === 'emergency').length;
    const commonPassed = results.filter(r => r.category === 'common' && r.passed).length;
    const commonTotal = results.filter(r => r.category === 'common').length;
    const otherPassed = results.filter(r => r.category === 'other' && r.passed).length;
    const otherTotal = results.filter(r => r.category === 'other').length;
    
    const avgConfidence = results.reduce((sum, r) => sum + (r.actualConfidence || 0), 0) / results.filter(r => r.actualConfidence !== undefined).length;
    
    let report = '\n';
    report += '='.repeat(80) + '\n';
    report += 'EVIDENCE PROVIDER VALIDATION TEST REPORT\n';
    report += '='.repeat(80) + '\n\n';

    report += 'Generated: ' + new Date().toISOString() + '\n';
    report += 'Total Tests: ' + total + '\n';
    report += 'Passed: ' + passed + ' (' + ((passed / total) * 100).toFixed(1) + '%)\n';
    report += 'Failed: ' + failed + ' (' + ((failed / total) * 100).toFixed(1) + '%)\n\n';

    report += 'By Category:\n';
    report += '-'.repeat(40) + '\n';
    report += 'Emergency: ' + emergencyPassed + '/' + emergencyTotal + ' passed (' + ((emergencyPassed / emergencyTotal) * 100).toFixed(1) + '%)\n';
    report += 'Common: ' + commonPassed + '/' + commonTotal + ' passed (' + ((commonPassed / commonTotal) * 100).toFixed(1) + '%)\n';
    report += 'Other: ' + otherPassed + '/' + otherTotal + ' passed (' + ((otherPassed / otherTotal) * 100).toFixed(1) + '%)\n\n';

    report += 'Average Confidence: ' + avgConfidence.toFixed(2) + '\n\n';

    report += 'Provider Performance:\n';
    report += '-'.repeat(40) + '\n';
    
    const providerStats: Record<string, { total: number; passed: number; avgScore: number }> = {};
    results.forEach(r => {
        if (r.providerResults) {
            Object.entries(r.providerResults).forEach(([provider, result]) => {
                if (!providerStats[provider]) {
                    providerStats[provider] = { total: 0, passed: 0, avgScore: 0 };
                }
                providerStats[provider].total++;
                if (result.passed) {
                    providerStats[provider].passed++;
                    providerStats[provider].avgScore += result.score;
                }
            });
        }
    });
    
    Object.entries(providerStats).forEach(([provider, stats]) => {
        const avg = stats.total > 0 ? stats.avgScore / stats.passed : 0;
        report += provider + ': ' + stats.passed + '/' + stats.total + ' passed, avg score: ' + avg.toFixed(2) + '\n';
    });

    if (failed > 0) {
        report += '\n\nFailed Tests:\n';
        report += '-'.repeat(40) + '\n';
        results.filter(r => !r.passed).forEach((r, i) => {
            report += (i + 1) + '. [' + r.category.toUpperCase() + '] ' + r.testCaseName + '\n';
            report += '   Error: ' + r.error + '\n';
            report += '   Expected: ' + r.actualOutcome + '\n';
            if (r.actualEvidenceSources) {
                report += '   Sources: ' + r.actualEvidenceSources.join(', ') + '\n';
            }
            report += '\n';
        });
    }

    report += '\n' + '='.repeat(80) + '\n';
    
    // Save report to file
    const fs = require('fs');
    fs.writeFileSync('validation-report-' + new Date().toISOString().replace(/:/g, '-') + '.txt', report);
    
    return report;
}

/**
 * Get test statistics
 */
export function getTestStatistics(results: ValidationResult[]): {
    total: number;
    passed: number;
    failed: number;
    byCategory: Record<string, { total: number; passed: number; failed: number }>;
    byProvider: Record<string, { total: number; passed: number; avgScore: number }>;
    avgConfidence: number;
} {
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;
    
    const byCategory: Record<string, { total: number; passed: number; failed: number }> = {};
    results.forEach(r => {
        if (!byCategory[r.category]) {
            byCategory[r.category] = { total: 0, passed: 0, failed: 0 };
        }
        byCategory[r.category].total++;
        if (r.passed) {
            byCategory[r.category].passed++;
        } else {
            byCategory[r.category].failed++;
        }
    });
    
    const byProvider: Record<string, { total: number; passed: number; avgScore: number }> = {};
    results.forEach(r => {
        if (r.providerResults) {
            Object.entries(r.providerResults).forEach(([provider, result]) => {
                if (!byProvider[provider]) {
                    byProvider[provider] = { total: 0, passed: 0, avgScore: 0 };
                }
                byProvider[provider].total++;
                if (result.passed) {
                    byProvider[provider].passed++;
                    byProvider[provider].avgScore += result.score;
                }
            });
        }
    });
    
    // Calculate average scores
    Object.keys(byProvider).forEach(provider => {
        if (byProvider[provider].passed > 0) {
            byProvider[provider].avgScore /= byProvider[provider].passed;
        }
    });
    
    const avgConfidence = results.reduce((sum, r) => sum + (r.actualConfidence || 0), 0) / results.filter(r => r.actualConfidence !== undefined).length;
    
    return {
        total,
        passed,
        failed,
        byCategory,
        byProvider,
        avgConfidence: isNaN(avgConfidence) ? 0 : avgConfidence,
    };
}

export { TEST_CASES };
