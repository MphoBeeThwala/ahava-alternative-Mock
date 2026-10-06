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
}

export interface TriageResult {
    triageLevel: 1 | 2 | 3 | 4 | 5; // 1 = Resuscitation, 5 = Non-urgent
    possibleConditions: string[];
    recommendedAction: string;
    reasoning: string;
    confidence: number; // 0-1 calibrated confidence (required for guardrails)
    uncertaintyFlags: string[]; // machine-readable uncertainty reasons
    evidenceSources: string[]; // restricted to approved clinical sources
    requiresDoctorReview: boolean; // fail-safe for uncertain or high-risk outputs
    // Set at the actual point a result is produced (a real model's own id, or
    // AI_UNAVAILABLE_MODEL_LABEL), so the doctor-facing "Model:" label can
    // never claim a model ran when it didn't.
    modelUsed: string;
    /** What went wrong with the AI providers for this case, if anything (no patient data). */
    providerFailures?: ProviderFailure[];
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

    return `${basePrompt}${patientSection}${contextSection}${SA_EPIDEMIOLOGICAL_CONTEXT}
Output ONLY valid JSON with the following structure:`;
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

const TRIAGE_PROMPT_END = `{
  "triageLevel": number (1-5, where 1 is critical/ER, 5 is basic home care),
  "possibleConditions": ["string", "string"],
  "recommendedAction": "string (Advice for the patient/nurse)",
  "reasoning": "string (Medical reasoning that cites the specific supplied findings)",
  "confidence": "number (0 to 1)",
  "uncertaintyFlags": ["string"],
  "evidenceSources": ["StatPearls/NCBI" | "SATS" | "WHO" | "Patient Symptoms" | "Patient Vitals" | "Patient Risk Profile"],
  "requiresDoctorReview": "boolean"
}

IMPORTANT: Output only the raw JSON object, no markdown formatting.
CRITICAL SAFETY RULES:
- Case isolation is mandatory: never use information from any other case or prior patient.
- Use only the provided symptoms, investigation results, attachments and explicit reference context.
- Do NOT use internet/general web knowledge beyond these allowed references.
- If uncertain, set low confidence, add uncertaintyFlags, and set requiresDoctorReview=true.
DISCLAIMER: This is for informational purposes only.`;

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

        const prompt = buildTriagePrompt(request, symptomsForModel, medicalContext, request.patientContext ?? null) + TRIAGE_PROMPT_END;

        const files: AiInputFile[] = [...(request.files ?? [])];
        if (request.imageBase64) {
            const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(request.imageBase64);
            if (m) files.unshift({ fileName: 'symptom-photo', mimeType: m[1].toLowerCase(), base64: m[2] });
        }
        const input = { prompt, files };
        const accept = (text: string, model: string) => validateTriageResult(extractJsonObject(text), model);

        const failures: ProviderFailure[] = [];
        let candidate: TriageResult | null = null;

        if (process.env.ANTHROPIC_API_KEY) {
            try {
                const ran = await runClaude(input, accept);
                candidate = ran.value;
                failures.push(...ran.failures);
            } catch (error) {
                if (error instanceof AiProviderError) failures.push(...error.failures);
                else failures.push({ provider: 'claude', model: 'n/a', kind: 'unknown', message: String((error as Error)?.message ?? error) });
            }
        }

        if (!candidate && process.env.GEMINI_API_KEY) {
            try {
                const ran = await runGemini(input, accept);
                candidate = ran.value;
                failures.push(...ran.failures);
            } catch (error) {
                if (error instanceof AiProviderError) failures.push(...error.failures);
                else failures.push({ provider: 'gemini', model: 'n/a', kind: 'unknown', message: String((error as Error)?.message ?? error) });
            }
        }

        if (!candidate) {
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

        const guarded = mergeGuardrails(candidate, fullSymptoms, request, inputTruncated);
        if (!hasEvidence) {
            guarded.confidence = Math.min(guarded.confidence, 0.5);
            guarded.uncertaintyFlags = [...new Set([...guarded.uncertaintyFlags, 'NO_PEER_REVIEW_CONTEXT'])];
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
