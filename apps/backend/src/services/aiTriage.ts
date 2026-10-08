import crypto from 'crypto';
import dotenv from 'dotenv';
import { combineEvidence, hasSufficientEvidence, getEvidenceSummary } from './evidenceProvider';
import { assessDeterministicRisk, stripNegatedSpans, TriageVitalsSnapshot, DeterministicRiskPatient } from './triageSafety';
import {
    AiInputFile,
    AiProviderError,
    extractJsonObject,
    runClaude,
    runGemini,
} from './aiProviders';
import type { ProviderFailure } from './aiHealth';
import type { ClinicalFindings } from './clinical/clinicalChecks';
import { calibrateConfidence } from './clinical/calibration';
import { validateClinicalPlan, deriveLegacyFields, type PlanValidation } from './clinical/clinicalPlan';
import {
    assessPlan, buildRecord, prepareClinicalContext, type ClinicalContext, type PlanAssessment, type StructuredPlanRecord,
} from './clinical/clinicalPipeline';
import { buildPlanPromptSections, buildRepairPrompt, PLAN_JSON_TEMPLATE } from './clinical/planPrompt';

dotenv.config();

const DEBUG = process.env.DEBUG === 'true';

/**
 * Model names are NOT hard-coded here any more: they come from the ordered,
 * configurable chains in services/aiProviders.ts (AI_CLAUDE_MODELS /
 * AI_GEMINI_MODELS, with known-good defaults), and the model that actually
 * produced a result is what `modelUsed` reports. If every model in both
 * chains fails, the case gets NO automated interpretation, only the
 * deterministic safety floor and a loud "AI analysis unavailable" flag
 * (see unavailableResult), never a guessed diagnosis.
 */
export const AI_UNAVAILABLE_MODEL_LABEL = 'no-ai-analysis (fallback: AI providers unavailable)';

// A patient or doctor can paste a full clinical history, with investigation
// results. This used to be cut to 1,600 characters without a word, which
// dropped exactly the findings (CSF, MRI, labs) that decide the diagnosis.
// The route caps submissions at 20,000 characters; this is the model-side
// ceiling, set above it. If it is ever exceeded, that is flagged, never silent.
const AI_MAX_SYMPTOMS_CHARS = Math.max(200, parseInt(process.env.AI_MAX_SYMPTOMS_CHARS ?? '24000', 10) || 24000);
const MAX_PATIENT_CONTEXT_CHARS = Math.max(500, parseInt(process.env.AI_MAX_CONTEXT_CHARS ?? '12000', 10) || 12000);
// What the public medical-reference searches get: they extract keywords, so a
// long narrative adds cost and noise, not accuracy.
const EVIDENCE_QUERY_CHARS = 3000;

const inFlightTriage = new Map<string, Promise<TriageResult>>();

export interface TriageRequest {
    symptoms: string;
    imageBase64?: string; // Optional image of the condition (data URL)
    /** Lab results / reports / follow-up documents (PDF or image) the patient attached. */
    files?: AiInputFile[];
    patientContext?: string; // Patient vitals, baselines, active alerts (injected by triage route)
    vitalsSnapshot?: TriageVitalsSnapshot; // Structured vitals for deterministic safety checks
    patient?: DeterministicRiskPatient; // AH-47: age/height, so assessDeterministicRisk never silently applies the adult chart
    patientId?: string; // For audit and explicit case isolation instruction
    caseId?: string; // Generated per triage request to prevent cross-case blending
    /** Extra structured values (labs etc.) that are already structured upstream. Feeds the deterministic checks. */
    findings?: ClinicalFindings;
}

export interface TriageResult {
    triageLevel: 1 | 2 | 3 | 4 | 5; // 1 = Resuscitation, 5 = Non-urgent
    possibleConditions: string[];
    recommendedAction: string;
    reasoning: string;
    /** 0-1 DIAGNOSTIC confidence, after the calibration caps (docs/CONFIDENCE_CALIBRATION.md). */
    confidence: number;
    /** 0-1 confidence in the urgency level, kept separate from diagnostic confidence. */
    triageConfidence?: number;
    uncertaintyFlags: string[]; // machine-readable uncertainty reasons
    evidenceSources: string[]; // restricted to approved clinical sources
    requiresDoctorReview: boolean; // fail-safe for uncertain or high-risk outputs
    // Set at the actual point a result is produced (a real model's own id, or
    // AI_UNAVAILABLE_MODEL_LABEL), so the doctor-facing "Model:" label can
    // never claim a model ran when it didn't.
    modelUsed: string;
    /** What went wrong with the AI providers for this case, if anything (no patient data). */
    providerFailures?: ProviderFailure[];
    /** Tiered clinician-only plan with the checks, lint and flags behind it. Absent for legacy or unavailable results. */
    plan?: StructuredPlanRecord;
}

const SA_EPIDEMIOLOGICAL_CONTEXT = `
SA/AFRICAN EPIDEMIOLOGICAL NOTE (South Africa disease burden: factor in only where the findings fit):
- TB (tuberculosis) is endemic; South Africa has one of the highest TB burdens globally. Consider TB in respiratory or constitutional symptom presentations.
- HIV/AIDS prevalence is ~13% of the adult population; immunocompromised states can mask or alter typical presentations.
- Non-communicable diseases (hypertension, type 2 diabetes, cardiovascular disease) are the leading cause of adult mortality in SA.
- Malnutrition, particularly in children and elderly, is common in under-resourced settings.
- Rheumatic heart disease remains prevalent due to high rates of untreated streptococcal pharyngitis.
- Community-acquired pneumonia in SA is frequently caused by Streptococcus pneumoniae, TB, or Pneumocystis jirovecii (in HIV+ patients).
- Malaria is present in Limpopo and KwaZulu-Natal low-lying areas; ask about travel history.
- SATS (South African Triage Scale) levels: 1=Resuscitation (<5 min), 2=Emergency (<10 min), 3=Urgent (<30 min), 4=Less-Urgent (<1h), 5=Non-Urgent (<4h).
`;

function buildTriagePrompt(
    request: TriageRequest,
    symptomsForModel: string,
    medicalContext?: string | null,
    patientContext?: string | null,
): string {
    const safePatientContext = boundedText(patientContext, MAX_PATIENT_CONTEXT_CHARS);
    const safeMedicalContext = boundedText(medicalContext, MAX_PATIENT_CONTEXT_CHARS);
    const caseId = request.caseId ?? 'UNSPECIFIED_CASE';
    const patientId = request.patientId ?? 'ANON_PATIENT';
    const fileNames = (request.files ?? []).map((f) => f.fileName).filter(Boolean);

    const basePrompt = `Act as a strictly objective medical triage assistant trained on the South African Triage Scale (SATS).
Analyze the following case (symptoms, history, any investigation results, and any attached documents or image) in the context of a South African patient.

CASE ISOLATION CONTRACT:
- case_id: ${caseId}
- patient_id: ${patientId}
- Treat this request as an isolated case.
- Never combine with any previous patient, case, or prior conversation context.
- If information is insufficient, return low confidence and requiresDoctorReview=true.

DIAGNOSTIC REASONING RULES:
- Base the differential on ALL the supplied findings, including laboratory, CSF, imaging and examination results written in the text or in the attached documents. Do not ignore investigation results.
- Do not default to common infectious or self-limiting causes when the findings point elsewhere (for example neurological, autoimmune, cardiac, endocrine, haematological or oncological causes).
- List possibleConditions most likely first, and in "reasoning" cite the specific supplied findings that support or argue against each leading condition.
- Where supplied findings suggest a time-critical or specialist-needed condition, say so in recommendedAction.
- Do not let one reassuring value (a normal blood pressure, glucose, heart rate or oxygen saturation, or a negative screening test) outweigh an abnormal combination of other findings. Name the pattern the findings form, and consider the conditions that occur WITHOUT the usually-expected abnormal value. A well-looking patient, a patient who denies symptoms, or a patient who says "it is probably nothing" does not lower the risk if the findings say otherwise.
- In pregnancy, or in the six weeks after delivery: low platelets, haemolysis (schistocytes, raised LDH, low haptoglobin), raised liver enzymes, new visual symptoms, severe headache, upper abdominal pain, seizures, or kidney injury must be treated as a possible hypertensive disorder of pregnancy (pre-eclampsia, eclampsia, HELLP) or acute fatty liver of pregnancy until proven otherwise. These occur with a NORMAL blood pressure; normal blood pressure does not argue against them. Thrombotic microangiopathies (TTP, HUS) are the main alternatives and are also emergencies, but do not rank one above a pregnancy-specific diagnosis only because the blood pressure is normal. Treat this picture as an obstetric emergency needing urgent obstetric review, at triage level 1 when there is end-organ involvement (visual loss, seizure, stroke symptoms, altered consciousness, very low platelets) and at least level 2 otherwise.

SYMPTOMS / CASE DESCRIPTION: "${symptomsForModel}"${fileNames.length > 0 ? `

ATTACHED DOCUMENTS (${fileNames.length}): ${fileNames.join(', ')}. Read them; they are part of the case.` : ''}`;

    const patientSection = safePatientContext
        ? `

PATIENT VITALS & HEALTH CONTEXT (from wearable/clinic measurements — use to inform severity and differential):
${safePatientContext}
`
        : '';

    const contextSection = safeMedicalContext
        ? `

CLINICAL REFERENCE (peer-reviewed context from StatPearls/NCBI — use to inform assessment, do not copy verbatim):
${safeMedicalContext}
`
        : '';

    return `${basePrompt}${patientSection}${contextSection}${SA_EPIDEMIOLOGICAL_CONTEXT}`;
}

const ALLOWED_EVIDENCE_SOURCES = new Set([
    'StatPearls/NCBI',
    'SATS',
    'WHO',
    'Patient Symptoms',
    'Patient Vitals',
    'Patient Risk Profile',
    'Local Clinical Rules',
]);

function boundedText(input: string | null | undefined, maxChars: number): string | null {
    if (!input) return null;
    const trimmed = input.trim();
    if (trimmed.length <= maxChars) return trimmed;
    return `${trimmed.slice(0, maxChars)}\n[context truncated for safety budget]`;
}

function normalizeSymptoms(symptoms: string): { text: string; truncated: boolean } {
    const cleaned = symptoms.trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
    if (cleaned.length <= AI_MAX_SYMPTOMS_CHARS) return { text: cleaned, truncated: false };
    return {
        text: `${cleaned.slice(0, AI_MAX_SYMPTOMS_CHARS)} [TEXT TRUNCATED: the case was longer than the analysis limit]`,
        truncated: true,
    };
}

function hashInput(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function buildInFlightKey(request: TriageRequest, symptomsForModel: string): string {
    const pid = request.patientId ?? 'anon';
    const imageHash = request.imageBase64 ? hashInput(request.imageBase64) : 'no-image';
    const filesHash = (request.files ?? []).map((f) => hashInput(f.base64)).join(',') || 'no-files';
    const vitalsHash = request.vitalsSnapshot ? hashInput(JSON.stringify(request.vitalsSnapshot)) : 'no-vitals';
    return `${pid}:${hashInput(`${symptomsForModel}|${imageHash}|${filesHash}|${vitalsHash}`)}`;
}

function sanitizeEvidenceSources(raw: unknown): string[] {
    const values = Array.isArray(raw) ? raw.map(String) : [];
    const filtered = values.filter((src) => ALLOWED_EVIDENCE_SOURCES.has(src));
    return filtered.length > 0 ? filtered : ['Local Clinical Rules'];
}

function hasOnlyGenericConditions(conditions: string[]): boolean {
    if (conditions.length === 0) return true;
    return conditions.every((condition) =>
        /undifferentiated|unclear|unspecified|unknown|presentation|condition requiring/i.test(condition),
    );
}

// Symptom phrases that, when AFFIRMED (a denial like "no chest pain" is
// masked), mean "treat as an emergency until a clinician says otherwise".
// Used only when no AI could analyse the case: it raises urgency, it never
// names a diagnosis.
const EMERGENCY_SCREEN_TERMS = [
    'chest pain', 'shortness of breath', "can't breathe", 'cannot breathe', 'difficulty breathing',
    'one-sided weakness', 'weakness on one side', 'slurred speech', 'seizure', 'unconscious', 'unresponsive',
];

function emergencyScreen(fullSymptoms: string): boolean {
    const text = stripNegatedSpans(fullSymptoms.toLowerCase());
    if (EMERGENCY_SCREEN_TERMS.some((t) => text.includes(t))) return true;
    // Stiff neck with fever, light sensitivity or confusion.
    return /\b(?:neck stiffness|stiff neck)\b/.test(text) && /\b(?:fever|photophobia|confusion)\b/.test(text);
}

/**
 * What a case gets when NO model could analyse it.
 *
 * This used to be a keyword guess dressed as a clinical opinion: a case with
 * "fatigue" in it came back as "Viral upper respiratory infection / Influenza-
 * like illness / Early bacterial infection" at SATS 4 (non-urgent), even when
 * the case was a multiple-sclerosis presentation. A guess shown as a
 * diagnosis is worse than no answer: it can anchor a clinician and it
 * downgrades urgency. Now the case carries no provisional diagnosis at all:
 * it says plainly that no analysis happened, keeps the deterministic safety
 * floor (red-flag rules, vitals scoring), is never rated less urgent than
 * SATS 3, and goes to a doctor who must read the case themselves.
 */
function unavailableResult(
    reason: string,
    fullSymptoms: string,
    request: TriageRequest,
    failures: ProviderFailure[],
): TriageResult {
    const risk = assessDeterministicRisk(fullSymptoms, request.vitalsSnapshot, request.patient);
    const emergency = emergencyScreen(fullSymptoms);
    const level = (emergency ? 1 : Math.min(3, risk.minTriageLevel)) as 1 | 2 | 3 | 4 | 5;
    const flagText = [...risk.hardFlags, ...risk.cautionFlags, ...(emergency ? ['EMERGENCY_RED_FLAG_NO_AI'] : [])];
    return {
        triageLevel: level,
        possibleConditions: ['AI analysis unavailable: no provisional diagnosis was generated'],
        recommendedAction:
            (emergency
                ? 'POSSIBLE EMERGENCY: red-flag symptoms were detected by keyword screening. Arrange immediate clinical assessment without waiting for any automated analysis. '
                : '') +
            'No automated clinical analysis could be produced for this case. A doctor must read the full history, investigation results and attachments directly and make their own assessment. If the patient has sudden, severe or worsening symptoms (loss of vision, weakness, trouble speaking, chest pain, breathing difficulty), they should go to the nearest emergency department.',
        reasoning:
            `AI analysis was unavailable (${reason}). No diagnostic interpretation was produced; this is NOT a finding that the case is mild. ` +
            (flagText.length > 0
                ? `Automatic safety rules flagged: ${flagText.join(', ')}. `
                : 'No automatic red-flag rule fired, which does not rule out serious illness. ') +
            `Priority is held at SATS ${level} or more urgent until a doctor reviews it.`,
        confidence: 0,
        uncertaintyFlags: [...new Set(['AI_ANALYSIS_UNAVAILABLE', 'AI_PROVIDER_FAILURE', 'FALLBACK_USED', ...flagText])],
        evidenceSources: ['Local Clinical Rules'],
        requiresDoctorReview: true,
        modelUsed: AI_UNAVAILABLE_MODEL_LABEL,
        providerFailures: failures,
    };
}

function mergeGuardrails(candidate: TriageResult, fullSymptoms: string, request: TriageRequest, inputTruncated: boolean): TriageResult {
    // The deterministic rules read the patient's COMPLETE text, not the
    // possibly-shortened copy the model saw.
    const risk = assessDeterministicRisk(fullSymptoms, request.vitalsSnapshot, request.patient);
    const confidence = Number.isFinite(candidate.confidence) ? Math.max(0, Math.min(1, candidate.confidence)) : 0;
    const uncertaintyFlags = [...new Set(candidate.uncertaintyFlags.filter(Boolean))];

    const mergedLevel = Math.min(candidate.triageLevel, risk.minTriageLevel) as 1 | 2 | 3 | 4 | 5;
    const combinedFlags = [...new Set([
        ...uncertaintyFlags,
        ...risk.hardFlags,
        ...risk.cautionFlags,
    ])];

    if (confidence < 0.55) combinedFlags.push('LOW_MODEL_CONFIDENCE');
    if (candidate.evidenceSources.length === 0) combinedFlags.push('NO_ALLOWED_EVIDENCE_SOURCE');
    if (inputTruncated) combinedFlags.push('INPUT_TRUNCATED');
    // A specific, correct answer is never replaced with a keyword guess any
    // more; if the model's answer is vague, say so and leave it to the doctor.
    if (hasOnlyGenericConditions(candidate.possibleConditions)) combinedFlags.push('GENERIC_MODEL_OUTPUT');

    // AH-42: every AI triage result requires doctor review before any
    // patient-facing use, unconditionally. Nothing the model reports gets a vote.
    const requiresDoctorReview = true;
    const actionPrefix = 'Doctor review required before patient-facing interpretation.';

    return {
        ...candidate,
        triageLevel: mergedLevel,
        uncertaintyFlags: [...new Set(combinedFlags)],
        requiresDoctorReview,
        recommendedAction: `${actionPrefix} ${candidate.recommendedAction}`.trim(),
        reasoning:
            `${candidate.reasoning}` +
            (inputTruncated ? ' NOTE: the case text was longer than the analysis limit and part of it was not analysed; the doctor must read the full text.' : '') +
            ` | Guardrails applied: min triage ${risk.minTriageLevel}, confidence ${confidence.toFixed(2)}.`,
    };
}

function validateTriageResult(parsed: unknown, source: string): TriageResult {
    const p = parsed as Record<string, unknown>;
    const level = Number(p?.triageLevel);
    if (!Number.isInteger(level) || level < 1 || level > 5) {
        throw new Error(`[aiTriage] Invalid triageLevel from ${source}: ${p?.triageLevel}`);
    }
    if (!Array.isArray(p?.possibleConditions) || (p.possibleConditions as unknown[]).length === 0) {
        throw new Error(`[aiTriage] Missing possibleConditions from ${source}`);
    }
    if (typeof p?.recommendedAction !== 'string' || (p.recommendedAction as string).trim() === '') {
        throw new Error(`[aiTriage] Missing recommendedAction from ${source}`);
    }
    if (typeof p?.reasoning !== 'string' || (p.reasoning as string).trim() === '') {
        throw new Error(`[aiTriage] Missing reasoning from ${source}`);
    }

    const rawEvidence = Array.isArray(p?.evidenceSources)
        ? p?.evidenceSources
        : Array.isArray(p?.evidence)
            ? (p?.evidence as unknown[]).map((e) => {
                if (typeof e === 'string') return e;
                if (e && typeof e === 'object' && 'source' in (e as Record<string, unknown>)) {
                    return String((e as Record<string, unknown>).source);
                }
                return '';
            })
            : [];
    const evidenceSources = sanitizeEvidenceSources(rawEvidence);
    const confidenceRaw = Number(p?.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.45;
    const uncertaintyFlags = Array.isArray(p?.uncertaintyFlags)
        ? (p.uncertaintyFlags as unknown[]).map(String).filter(Boolean)
        : [];
    const requiresDoctorReview = Boolean(
        (p?.requiresDoctorReview ?? (confidence < 0.7)) || uncertaintyFlags.length > 0
    );

    return {
        triageLevel: level as 1 | 2 | 3 | 4 | 5,
        possibleConditions: (p.possibleConditions as unknown[]).map(String),
        recommendedAction: (p.recommendedAction as string).trim(),
        reasoning: (p.reasoning as string).trim(),
        confidence,
        uncertaintyFlags,
        evidenceSources,
        requiresDoctorReview,
        modelUsed: source,
    };
}

function parseAnswer(text: string, model: string, questions: string[]): ParsedAnswer {
    const raw = extractJsonObject(text);
    const validation = validateClinicalPlan(raw, questions);
    if (validation.plan) return { text, model, validation, legacy: null };
    // Not the structured plan: accept the older flat shape (still a valid triage answer),
    // or throw so the chain tries the next model, exactly as before.
    return { text, model, validation, legacy: validateTriageResult(raw, model) };
}

/** Turn the (possibly repaired) model answer into a TriageResult, with calibrated confidence and the clinician plan. */
function buildCandidate(
    parsed: ParsedAnswer,
    assessment: PlanAssessment | null,
    clinical: ClinicalContext,
    fullSymptoms: string,
    noReferenceEvidence: boolean,
    rounds: number,
): TriageResult {
    if (!assessment || !parsed.validation.plan) {
        // Older flat shape. Still never let an uncalibrated 0.9 through.
        const legacy = parsed.legacy!;
        const cal = calibrateConfidence({
            modelTriageConfidence: legacy.confidence,
            modelDiagnosticConfidence: legacy.confidence,
            claimedConfirmation: 'clinical_only',
            alternativeProbabilities: [],
            caseText: fullSymptoms,
            noReferenceEvidence,
        });
        return {
            ...legacy,
            confidence: cal.diagnostic.value,
            triageConfidence: cal.triage.value,
            uncertaintyFlags: [...new Set([...legacy.uncertaintyFlags, 'NO_STRUCTURED_PLAN'])],
        };
    }
    const record = buildRecord(assessment, clinical, { schemaIssuesRemaining: parsed.validation.issues, repairRounds: rounds });
    const plan = record.plan;
    const derived = deriveLegacyFields(plan);
    const flagCodes = [...new Set(record.reviewerFlags.filter((f) => f.severity === 'high').map((f) => f.code))];
    return {
        triageLevel: plan.triageLevel,
        possibleConditions: derived.possibleConditions,
        recommendedAction: derived.recommendedAction,
        reasoning: derived.reasoning,
        confidence: record.calibration.diagnostic.value,
        triageConfidence: record.calibration.triage.value,
        uncertaintyFlags: [...new Set([...plan.uncertaintyFlags, ...flagCodes])],
        evidenceSources: sanitizeEvidenceSources(plan.evidenceSources),
        requiresDoctorReview: true,
        modelUsed: parsed.model,
        plan: record,
    };
}

const TRIAGE_PROMPT_END = `${PLAN_JSON_TEMPLATE}

IMPORTANT: Output only the raw JSON object, no markdown formatting.
CRITICAL SAFETY RULES:
- Case isolation is mandatory: never use information from any other case or prior patient.
- Use only the provided symptoms, investigation results, attachments and explicit reference context.
- Do NOT use internet/general web knowledge beyond these allowed references.
- If uncertain, set low probabilities, add uncertaintyFlags, and say what would resolve the uncertainty.
- This is a draft for a reviewing doctor; it is never shown to the patient as advice.
DISCLAIMER: This is for informational purposes only.`;

/** Rounds of targeted re-prompting after the first answer (schema gaps, missing required elements, unsupported terms). */
const repairRounds = () => Math.max(0, Math.min(2, parseInt(process.env.AI_PLAN_REPAIR_ROUNDS ?? '1', 10) || 0));

interface ParsedAnswer {
    text: string;
    model: string;
    validation: PlanValidation;
    /** Set when the model answered in the older flat shape instead of the structured plan. */
    legacy: TriageResult | null;
}

// Main function: Claude chain, then Gemini chain, then an honest "unavailable".
export async function analyzeSymptoms(request: TriageRequest): Promise<TriageResult> {
    const fullSymptoms = request.symptoms;
    const { text: symptomsForModel, truncated: inputTruncated } = normalizeSymptoms(fullSymptoms);

    if (DEBUG) {
        console.log(`[aiTriage] analyzeSymptoms called caseId=${request.caseId ?? 'n/a'} patientContext=${!!request.patientContext}`);
    }

    const dedupeKey = buildInFlightKey(request, symptomsForModel);
    const existing = inFlightTriage.get(dedupeKey);
    if (existing) {
        if (DEBUG) console.log('[aiTriage] Reusing in-flight triage computation for identical request');
        return existing;
    }

    const work = (async (): Promise<TriageResult> => {
        // Fetch medical context from all enabled evidence providers
        const combinedEvidence = await combineEvidence({
            symptoms: symptomsForModel.slice(0, EVIDENCE_QUERY_CHARS),
            imageBase64: request.imageBase64,
            patientContext: request.patientContext,
        });

        const hasEvidence = hasSufficientEvidence(combinedEvidence);
        if (DEBUG) {
            console.log('[aiTriage] Evidence sources:', getEvidenceSummary(combinedEvidence),
                ', queried:', combinedEvidence.sourcesQueried.join(', '),
                ', succeeded:', combinedEvidence.sourcesSucceeded.join(', '));
        }

        let medicalContext: string | null = null;
        if (combinedEvidence.results.length > 0) {
            medicalContext = combinedEvidence.results.map((r) =>
                '\n\n## ' + r.sourceId.toUpperCase() + ' Reference\n' +
                'Citation: ' + r.citation + '\n' +
                r.content,
            ).join('');
        }

        // Deterministic layer first: what the numbers say, which tests cannot
        // rule disease out, which questions the case asks, and which elements
        // the plan must cover. The model is told all of it before it writes.
        const clinical = prepareClinicalContext({
            caseText: fullSymptoms,
            vitals: request.vitalsSnapshot,
            structured: request.findings,
        });
        const prompt = `${buildTriagePrompt(request, symptomsForModel, medicalContext, request.patientContext ?? null)}

${buildPlanPromptSections({ checks: clinical.checks, limitations: clinical.limitations, questions: clinical.questions, required: clinical.required })}

Output ONLY valid JSON with the following structure:
${TRIAGE_PROMPT_END}`;

        const files: AiInputFile[] = [...(request.files ?? [])];
        if (request.imageBase64) {
            const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(request.imageBase64);
            if (m) files.unshift({ fileName: 'symptom-photo', mimeType: m[1].toLowerCase(), base64: m[2] });
        }

        const failures: ProviderFailure[] = [];
        const ask = async (promptText: string): Promise<ParsedAnswer | null> => {
            const input = { prompt: promptText, files };
            const accept = (text: string, model: string): ParsedAnswer => parseAnswer(text, model, clinical.questions);
            if (process.env.ANTHROPIC_API_KEY) {
                try {
                    const ran = await runClaude(input, accept);
                    failures.push(...ran.failures);
                    return ran.value;
                } catch (error) {
                    if (error instanceof AiProviderError) failures.push(...error.failures);
                    else failures.push({ provider: 'claude', model: 'n/a', kind: 'unknown', message: String((error as Error)?.message ?? error) });
                }
            }
            if (process.env.GEMINI_API_KEY) {
                try {
                    const ran = await runGemini(input, accept);
                    failures.push(...ran.failures);
                    return ran.value;
                } catch (error) {
                    if (error instanceof AiProviderError) failures.push(...error.failures);
                    else failures.push({ provider: 'gemini', model: 'n/a', kind: 'unknown', message: String((error as Error)?.message ?? error) });
                }
            }
            return null;
        };

        let parsed = await ask(prompt);

        if (!parsed) {
            const noProvider = !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY;
            const reason = noProvider
                ? 'no AI provider is configured'
                : `all configured AI providers failed: ${failures.map((f) => `${f.provider}/${f.model}=${f.kind}`).join(', ') || 'unknown'}`;
            const unavailable = unavailableResult(reason, fullSymptoms, request, failures);
            if (inputTruncated) unavailable.uncertaintyFlags.push('INPUT_TRUNCATED');
            if (!hasEvidence) unavailable.uncertaintyFlags.push('NO_EVIDENCE_SOURCES_AVAILABLE');
            unavailable.uncertaintyFlags.push('NO_PEER_REVIEW_CONTEXT');
            return unavailable;
        }

        // Validate, lint and (at most `repairRounds`) re-prompt once with exactly what is wrong.
        const evaluate = (p: ParsedAnswer): { assessment: PlanAssessment | null; issues: string[] } => {
            if (!p.validation.plan) {
                return { assessment: null, issues: ['The answer did not use the required structured plan format. Return the complete structured JSON described above.'] };
            }
            const assessment = assessPlan(p.validation.plan, p.validation.issues, clinical, fullSymptoms, { noReferenceEvidence: !hasEvidence });
            return { assessment, issues: assessment.repairIssues };
        };
        let current = evaluate(parsed);
        let rounds = 0;
        for (let round = 0; round < repairRounds() && current.issues.length > 0; round++) {
            rounds += 1;
            const repaired = await ask(buildRepairPrompt({ originalPrompt: prompt, previousAnswer: parsed.text, issues: current.issues }));
            if (!repaired) break; // keep the first answer; the gaps are flagged for the doctor
            const next = evaluate(repaired);
            const betterShape = !!next.assessment && !current.assessment;
            if (betterShape || (!!next.assessment === !!current.assessment && next.issues.length < current.issues.length)) {
                parsed = repaired;
                current = next;
            }
        }

        const candidate = buildCandidate(parsed, current.assessment, clinical, fullSymptoms, !hasEvidence, rounds);

        const guarded = mergeGuardrails(candidate, fullSymptoms, request, inputTruncated);
        if (!hasEvidence) {
            guarded.confidence = Math.min(guarded.confidence, 0.5);
            guarded.uncertaintyFlags = [...new Set([...guarded.uncertaintyFlags, 'NO_PEER_REVIEW_CONTEXT'])];
        }
        if (guarded.plan && guarded.triageLevel !== guarded.plan.plan.triageLevel) {
            guarded.plan.reviewerFlags.push({
                code: 'TRIAGE_RAISED_BY_RULES', severity: 'info',
                message: `The model rated this SATS ${guarded.plan.plan.triageLevel}; the deterministic safety rules raised it to SATS ${guarded.triageLevel}.`,
            });
        }
        if (failures.length > 0) guarded.providerFailures = failures; // a model failed but another succeeded: still worth knowing
        return guarded;
    })();

    inFlightTriage.set(dedupeKey, work);
    try {
        return await work;
    } finally {
        inFlightTriage.delete(dedupeKey);
    }
}
