export interface TriageVitalsSnapshot {
    heartRateResting?: number | null;
    oxygenSaturation?: number | null;
    respiratoryRate?: number | null;
    temperature?: number | null;
    bloodPressureSystolic?: number | null;
    bloodPressureDiastolic?: number | null;
    hrvRmssd?: number | null;
}

export interface DeterministicRiskAssessment {
    minTriageLevel: 1 | 2 | 3 | 4 | 5;
    hardFlags: string[];
    cautionFlags: string[];
}

function hasAnyPattern(input: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(input));
}

export function assessDeterministicRisk(
    symptoms: string,
    vitals?: TriageVitalsSnapshot | null
): DeterministicRiskAssessment {
    const normalizedSymptoms = symptoms.toLowerCase();
    const hardFlags: string[] = [];
    const cautionFlags: string[] = [];
    let minTriageLevel: 1 | 2 | 3 | 4 | 5 = 5;

    const level1Patterns = [
        /\bunconscious\b/,
        /\bunresponsive\b/,
        /\bseizure\b/,
        /\bstroke\b/,
        /\bone[-\s]?sided weakness\b/,
        /\bblue lips\b/,
        /\bsevere bleeding\b/,
        /\bnot breathing\b/,
        /\bcardiac arrest\b/,
        /\boverdose\b/,
        /\bsuicid(al|e)\b/,
        /\banaphylaxis\b/,
    ];
    const level2Patterns = [
        /\bchest pain\b/,
        /\bshort(ness)? of breath\b/,
        /\bdifficulty breathing\b/,
        /\bconfusion\b/,
        /\bhigh fever\b/,
        /\bblood in (stool|urine|vomit)\b/,
        /\bpregnan(t|cy).*(bleed|pain)\b/,
        /\bsevere abdominal pain\b/,
    ];

    if (hasAnyPattern(normalizedSymptoms, level1Patterns)) {
        hardFlags.push('CRITICAL_SYMPTOM_PATTERN');
        minTriageLevel = 1;
    } else if (hasAnyPattern(normalizedSymptoms, level2Patterns)) {
        cautionFlags.push('HIGH_RISK_SYMPTOM_PATTERN');
        minTriageLevel = 2;
    }

    if (vitals) {
        const hr = Number(vitals.heartRateResting ?? NaN);
        const spo2 = Number(vitals.oxygenSaturation ?? NaN);
        const rr = Number(vitals.respiratoryRate ?? NaN);
        const temp = Number(vitals.temperature ?? NaN);
        const sys = Number(vitals.bloodPressureSystolic ?? NaN);
        const dia = Number(vitals.bloodPressureDiastolic ?? NaN);

        if (!Number.isNaN(spo2)) {
            if (spo2 < 90) {
                hardFlags.push('CRITICAL_HYPOXEMIA');
                minTriageLevel = 1;
            } else if (spo2 < 94 && minTriageLevel > 2) {
                cautionFlags.push('LOW_SPO2');
                minTriageLevel = 2;
            }
        }

        if (!Number.isNaN(rr)) {
            if (rr >= 30) {
                hardFlags.push('CRITICAL_RESPIRATORY_RATE');
                minTriageLevel = 1;
            } else if (rr >= 24 && minTriageLevel > 2) {
                cautionFlags.push('ELEVATED_RESPIRATORY_RATE');
                minTriageLevel = 2;
            }
        }

        if (!Number.isNaN(hr)) {
            if (hr >= 130 || hr <= 40) {
                hardFlags.push('CRITICAL_HEART_RATE');
                minTriageLevel = 1;
            } else if ((hr >= 110 || hr <= 50) && minTriageLevel > 2) {
                cautionFlags.push('ABNORMAL_HEART_RATE');
                minTriageLevel = 2;
            }
        }

        if (!Number.isNaN(temp) && temp >= 39.5 && minTriageLevel > 2) {
            cautionFlags.push('HIGH_FEVER');
            minTriageLevel = 2;
        }

        if ((!Number.isNaN(sys) && sys >= 180) || (!Number.isNaN(dia) && dia >= 120)) {
            if (minTriageLevel > 2) minTriageLevel = 2;
            cautionFlags.push('SEVERE_HYPERTENSION');
        }
    }

    return { minTriageLevel, hardFlags, cautionFlags };
}

