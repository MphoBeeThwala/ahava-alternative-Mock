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

    // Level 1 (Resuscitation) - Immediate life-threatening conditions
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
        /\banaphylactic shock\b/,
        /\bcannot speak\b/,
        /\bchoking\b/,
        /\bcollapsed\b/,
        /\bno pulse\b/,
    ];

    // Level 2 (Emergency) - High-risk conditions requiring urgent care
    const level2Patterns = [
        /\bchest pain\b/,
        /\bshort(ness)? of breath\b/,
        /\bdifficulty breathing\b/,
        /\bconfusion\b/,
        /\bhigh fever\b/,
        /\bblood in (stool|urine|vomit|sputum|cough)\b/,
        /\bpregnan(t|cy).*(bleed|pain|vaginal bleeding)\b/,
        /\bsevere abdominal pain\b/,
        /\bsevere headache\b/,
        /\bvision changes\b/,
        /\bspeech difficulty\b/,
        /\bweakness on one side\b/,
        /\bdrooping face\b/,
        /\bnumbs?ness\b/,
        /\bparalysis\b/,
    ];

    // South Africa-specific patterns (TB, HIV, Malaria endemic regions)
    const saSpecificPatterns = {
        level1: [
            /\bsevere immunodeficiency\b/,
            /\bopportunistic infection\b/,
        ],
        level2: [
            // TB symptoms (endemic in SA - high burden globally)
            /\bcough.*(blood|bloody)\b/,
            /\bcoughing up blood\b/,
            /\bhaemoptysis\b/,
            /\bnight sweats\b/,
            /\bweight loss.*(unintentional|unexplained)\b/,
            /\bpersistent cough\b/,
            /\bcough for (more than|over) (2|three) weeks\b/,
            // HIV/AIDS related (13% prevalence in SA adults)
            /\bfever.*night sweats\b/,
            /\bchronic diarrhoea\b/,
            /\boral thrush\b/,
            /\bwhite patches.*mouth\b/,
            /\bpersistent fever\b/,
            /\bunexplained weight loss\b/,
            // Malaria (endemic in Limpopo, KwaZulu-Natal low-lying areas)
            /\bfever.*chills\b/,
            /\bcyclic fever\b/,
            /\bmalaria\b/,
            /\btravel.*(limpopo|kwazulu|mozambique|zimbabwe)\b/,
            // Diabetes complications (high prevalence in SA)
            /\bdiabetic.*ketoacidosis\b/,
            /\bDKA\b/,
            /\bfruity breath\b/,
            /\bexcessive thirst\b/,
            /\bfrequent urination.*excessive\b/,
            // Hypertension complications
            /\bsevere hypertension\b/,
            /\bheadache.*blurred vision\b/,
            // Pediatric emergencies
            /\bchild.*high fever\b/,
            /\bbaby.*fever\b/,
            /\bpediatric.*dehydration\b/,
            /\bchild.*difficulty breathing\b/,
            // Obstetric emergencies
            /\bpregnan(t|cy).*severe headache\b/,
            /\bpregnan(t|cy).*visual disturbances\b/,
            /\bpregnan(t|cy).*abdominal pain\b/,
            /\bpregnan(t|cy).*decreased fetal movement\b/,
            /\bwater broke\b/,
            /\blabour.*pain\b/,
            // Trauma
            /\bhead.*injury\b/,
            /\bfracture\b/,
            /\bbroken bone\b/,
            /\bsevere pain.*injury\b/,
        ],
    };

    // Check Level 1 patterns first (highest priority)
    if (hasAnyPattern(normalizedSymptoms, level1Patterns)) {
        hardFlags.push('CRITICAL_SYMPTOM_PATTERN');
        minTriageLevel = 1;
    }

    // Check SA-specific Level 1 patterns
    if (hasAnyPattern(normalizedSymptoms, saSpecificPatterns.level1 || [])) {
        hardFlags.push('SA_CRITICAL_CONDITION');
        minTriageLevel = 1;
    }

    // Check Level 2 patterns
    if (minTriageLevel > 2 && hasAnyPattern(normalizedSymptoms, level2Patterns)) {
        cautionFlags.push('HIGH_RISK_SYMPTOM_PATTERN');
        minTriageLevel = 2;
    }

    // Check SA-specific Level 2 patterns
    if (minTriageLevel > 2 && hasAnyPattern(normalizedSymptoms, saSpecificPatterns.level2 || [])) {
        cautionFlags.push('SA_HIGH_RISK_CONDITION');
        minTriageLevel = 2;
    }

    // Vital signs assessment
    if (vitals) {
        const hr = Number(vitals.heartRateResting ?? NaN);
        const spo2 = Number(vitals.oxygenSaturation ?? NaN);
        const rr = Number(vitals.respiratoryRate ?? NaN);
        const temp = Number(vitals.temperature ?? NaN);
        const sys = Number(vitals.bloodPressureSystolic ?? NaN);
        const dia = Number(vitals.bloodPressureDiastolic ?? NaN);
        const hrv = Number(vitals.hrvRmssd ?? NaN);

        // Hypoxemia thresholds (SATS-aligned)
        if (!Number.isNaN(spo2)) {
            if (spo2 < 85) {
                hardFlags.push('CRITICAL_HYPOXEMIA');
                minTriageLevel = 1;
            } else if (spo2 < 90) {
                hardFlags.push('SEVERE_HYPOXEMIA');
                minTriageLevel = 1;
            } else if (spo2 < 94 && minTriageLevel > 2) {
                cautionFlags.push('LOW_SPO2');
                minTriageLevel = 2;
            }
        }

        // Respiratory rate thresholds
        if (!Number.isNaN(rr)) {
            if (rr >= 35) {
                hardFlags.push('CRITICAL_RESPIRATORY_RATE');
                minTriageLevel = 1;
            } else if (rr >= 30) {
                hardFlags.push('CRITICAL_RESPIRATORY_RATE');
                minTriageLevel = 1;
            } else if (rr >= 25 && minTriageLevel > 2) {
                cautionFlags.push('ELEVATED_RESPIRATORY_RATE');
                minTriageLevel = 2;
            } else if (rr >= 24 && minTriageLevel > 2) {
                cautionFlags.push('ELEVATED_RESPIRATORY_RATE');
                minTriageLevel = 2;
            }
            // Bradypnea
            if (rr <= 8 && minTriageLevel > 1) {
                hardFlags.push('CRITICAL_BRADYPNEA');
                minTriageLevel = 1;
            } else if (rr <= 10 && minTriageLevel > 2) {
                cautionFlags.push('LOW_RESPIRATORY_RATE');
                minTriageLevel = 2;
            }
        }

        // Heart rate thresholds (SATS-aligned)
        if (!Number.isNaN(hr)) {
            if (hr >= 140 || hr <= 35) {
                hardFlags.push('CRITICAL_HEART_RATE');
                minTriageLevel = 1;
            } else if (hr >= 130 || hr <= 40) {
                hardFlags.push('CRITICAL_HEART_RATE');
                minTriageLevel = 1;
            } else if ((hr >= 120 || hr <= 45) && minTriageLevel > 2) {
                cautionFlags.push('TACHYCARDIA');
                minTriageLevel = 2;
            } else if ((hr >= 110 || hr <= 50) && minTriageLevel > 2) {
                cautionFlags.push('ABNORMAL_HEART_RATE');
                minTriageLevel = 2;
            }
            // Bradycardia
            if (hr <= 50 && hr > 40 && minTriageLevel > 3) {
                cautionFlags.push('BRADYCARDIA');
                minTriageLevel = 3;
            }
        }

        // Temperature thresholds
        if (!Number.isNaN(temp)) {
            if (temp >= 41.0 && minTriageLevel > 1) {
                hardFlags.push('CRITICAL_HYPERPYREXIA');
                minTriageLevel = 1;
            } else if (temp >= 39.5 && minTriageLevel > 2) {
                cautionFlags.push('HIGH_FEVER');
                minTriageLevel = 2;
            } else if (temp >= 39.0 && minTriageLevel > 3) {
                cautionFlags.push('FEVER');
                minTriageLevel = 3;
            }
            // Hypothermia
            if (temp <= 35.0 && minTriageLevel > 2) {
                hardFlags.push('HYPOTHERMIA');
                minTriageLevel = 2;
            } else if (temp <= 35.5 && minTriageLevel > 3) {
                cautionFlags.push('LOW_TEMPERATURE');
                minTriageLevel = 3;
            }
        }

        // Blood pressure thresholds (SATS-aligned)
        if (!Number.isNaN(sys) || !Number.isNaN(dia)) {
            // Hypertensive crisis
            if ((!Number.isNaN(sys) && sys >= 220) || (!Number.isNaN(dia) && dia >= 130)) {
                hardFlags.push('HYPERTENSIVE_CRISIS');
                minTriageLevel = 1;
            } else if ((!Number.isNaN(sys) && sys >= 180) || (!Number.isNaN(dia) && dia >= 120)) {
                if (minTriageLevel > 2) minTriageLevel = 2;
                cautionFlags.push('SEVERE_HYPERTENSION');
            } else if ((!Number.isNaN(sys) && sys >= 160) || (!Number.isNaN(dia) && dia >= 100)) {
                if (minTriageLevel > 3) minTriageLevel = 3;
                cautionFlags.push('MODERATE_HYPERTENSION');
            }
            // Hypotension
            if ((!Number.isNaN(sys) && sys <= 80) && minTriageLevel > 2) {
                hardFlags.push('SEVERE_HYPOTENSION');
                minTriageLevel = 2;
            } else if ((!Number.isNaN(sys) && sys <= 90) && minTriageLevel > 3) {
                cautionFlags.push('LOW_BLOOD_PRESSURE');
                minTriageLevel = 3;
            }
        }

        // HRV (Heart Rate Variability) - Low HRV indicates stress/illness
        if (!Number.isNaN(hrv)) {
            if (hrv <= 15 && minTriageLevel > 2) {
                cautionFlags.push('LOW_HRV');
                minTriageLevel = 2;
            } else if (hrv <= 20 && minTriageLevel > 3) {
                cautionFlags.push('REDUCED_HRV');
                minTriageLevel = 3;
            }
        }
    }

    return { minTriageLevel, hardFlags, cautionFlags };
}

/**
 * Check if image evidence forces doctor review
 * When an image is submitted but VisualDx is not enabled, force review
 */
export function checkImageEvidence(imageSubmitted: boolean, visualDxEnabled: boolean = false): { forceReview: boolean; flag?: string } {
  if (imageSubmitted && !visualDxEnabled) {
    return { forceReview: true, flag: 'IMAGE_EVIDENCE_MISSING' };
  }
  return { forceReview: false };
}
