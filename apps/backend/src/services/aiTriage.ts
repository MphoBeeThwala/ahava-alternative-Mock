import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import crypto from 'crypto';
import { combineEvidence, hasSufficientEvidence, getEvidenceSummary } from './evidenceProvider';
import { assessDeterministicRisk, TriageVitalsSnapshot } from './triageSafety';
import { withResilientHttp } from './resilientHttp';

dotenv.config();

const DEBUG = process.env.DEBUG === 'true';

// API Keys
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Key presence is logged at startup only — no patient data in logs
if (DEBUG) console.log(`[aiTriage] providers configured: gemini=${!!GEMINI_API_KEY} claude=${!!ANTHROPIC_API_KEY}`);

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const AI_MAX_SYMPTOMS_CHARS = Math.max(200, parseInt(process.env.AI_MAX_SYMPTOMS_CHARS ?? '1600', 10) || 1600);
const AI_PROVIDER_TIMEOUT_MS = Math.max(2000, parseInt(process.env.AI_PROVIDER_TIMEOUT_MS ?? '12000', 10) || 12000);
const AI_PROVIDER_RETRIES = Math.max(0, parseInt(process.env.AI_PROVIDER_RETRIES ?? '1', 10) || 1);
const AI_PROVIDER_CIRCUIT_THRESHOLD = Math.max(1, parseInt(process.env.AI_PROVIDER_CIRCUIT_THRESHOLD ?? '4', 10) || 4);
const AI_PROVIDER_CIRCUIT_OPEN_MS = Math.max(1000, parseInt(process.env.AI_PROVIDER_CIRCUIT_OPEN_MS ?? '20000', 10) || 20000);

const inFlightTriage = new Map<string, Promise<TriageResult>>();

export interface TriageRequest {
    symptoms: string;
    imageBase64?: string; // Optional image of the condition
    patientContext?: string; // Patient vitals, baselines, active alerts (injected by triage route)
    vitalsSnapshot?: TriageVitalsSnapshot; // Structured vitals for deterministic safety checks
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
}

const SA_EPIDEMIOLOGICAL_CONTEXT = `
SA/AFRICAN EPIDEMIOLOGICAL NOTE (South Africa disease burden — factor into differential diagnosis):
- TB (tuberculosis) is endemic; South Africa has one of the highest TB burdens globally. Consider TB in any respiratory or constitutional symptom presentation.
- HIV/AIDS prevalence is ~13% of the adult population; immunocompromised states can mask or alter typical presentations.
- Non-communicable diseases (hypertension, type 2 diabetes, cardiovascular disease) are the leading cause of adult mortality in SA.
- Malnutrition, particularly in children and elderly, is common in under-resourced settings.
- Rheumatic heart disease remains prevalent due to high rates of untreated streptococcal pharyngitis.
- Community-acquired pneumonia in SA is frequently caused by Streptococcus pneumoniae, TB, or Pneumocystis jirovecii (in HIV+ patients).
- Malaria is present in Limpopo and KwaZulu-Natal low-lying areas; ask about travel history.
- SATS (South African Triage Scale) levels: 1=Resuscitation (<5 min), 2=Emergency (<10 min), 3=Urgent (<30 min), 4=Less-Urgent (<1h), 5=Non-Urgent (<4h).
`;

function buildTriagePrompt(request: TriageRequest, medicalContext?: string | null, patientContext?: string | null): string {
    const safePatientContext = boundedText(patientContext, MAX_PATIENT_CONTEXT_CHARS);
    const safeMedicalContext = boundedText(medicalContext, MAX_PATIENT_CONTEXT_CHARS);
    const safeSymptoms = normalizeSymptoms(request.symptoms);
    const caseId = request.caseId ?? 'UNSPECIFIED_CASE';
    const patientId = request.patientId ?? 'ANON_PATIENT';

    const basePrompt = `Act as a strictly objective medical triage assistant trained on the South African Triage Scale (SATS).
Analyze the following symptoms and (optional) image in the context of a South African patient.

CASE ISOLATION CONTRACT:
- case_id: ${caseId}
- patient_id: ${patientId}
- Treat this request as an isolated case.
- Never combine with any previous patient, case, or prior conversation context.
- If information is insufficient, return low confidence and requiresDoctorReview=true.

SYMPTOMS: "${safeSymptoms}"`;

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

const MAX_PATIENT_CONTEXT_CHARS = 2800;

function boundedText(input: string | null | undefined, maxChars: number): string | null {
    if (!input) return null;
    const trimmed = input.trim();
    if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n[context truncated for safety budget]`;
}

function normalizeSymptoms(symptoms: string): string {
  const cleaned = symptoms.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= AI_MAX_SYMPTOMS_CHARS) return cleaned;
  return `${cleaned.slice(0, AI_MAX_SYMPTOMS_CHARS)} [symptoms truncated for safety budget]`;
}

function hashInput(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}


function buildInFlightKey(request: TriageRequest): string {
  const pid = request.patientId ?? 'anon';
  const symptoms = normalizeSymptoms(request.symptoms);
  const imageHash = request.imageBase64 ? hashInput(request.imageBase64) : 'no-image';
  const vitalsHash = request.vitalsSnapshot ? hashInput(JSON.stringify(request.vitalsSnapshot)) : 'no-vitals';
  return `${pid}:${hashInput(`${symptoms}|${imageHash}|${vitalsHash}`)}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function sanitizeEvidenceSources(raw: unknown): string[] {
    const values = Array.isArray(raw) ? raw.map(String) : [];
    const filtered = values.filter((src) => ALLOWED_EVIDENCE_SOURCES.has(src));
    return filtered.length > 0 ? filtered : ['Local Clinical Rules'];
}

function includesAnySymptom(text: string, terms: string[]): boolean {
    return terms.some((term) => text.includes(term));
}

function deriveFallbackOpinion(symptoms: string): Pick<TriageResult, 'triageLevel' | 'possibleConditions' | 'recommendedAction' | 'reasoning'> {
    const text = symptoms.toLowerCase();

    if (includesAnySymptom(text, ['chest pain', 'shortness of breath', 'can\'t breathe', 'difficulty breathing', 'one-sided weakness', 'slurred speech', 'seizure', 'unconscious'])) {
        return {
            triageLevel: 1,
            possibleConditions: ['Acute cardiopulmonary emergency', 'Stroke or neurological emergency', 'Severe asthma exacerbation or pulmonary process'],
            recommendedAction: 'Arrange immediate emergency assessment and do not delay referral to emergency care.',
            reasoning: 'Red-flag cardiopulmonary or neurological symptoms were detected, so the fallback opinion treats this as an emergency presentation.',
        };
    }

    if (includesAnySymptom(text, ['sore throat', 'tonsil', 'painful swallowing', 'swallowing']) && includesAnySymptom(text, ['fever', 'white patch', 'white patches', 'swollen glands', 'neck glands'])) {
        return {
            triageLevel: 3,
            possibleConditions: ['Acute bacterial tonsillitis or streptococcal pharyngitis', 'Viral pharyngitis', 'Early peritonsillar infection'],
            recommendedAction: 'Doctor should review for throat infection, hydration status, airway compromise, and antibiotic suitability after allergy check.',
            reasoning: 'The symptom pattern fits an acute throat infection with inflammatory features, making tonsillitis or streptococcal pharyngitis the leading provisional impression.',
        };
    }

    if (includesAnySymptom(text, ['cough', 'fever']) && includesAnySymptom(text, ['shortness of breath', 'breathless', 'chest'])) {
        return {
            triageLevel: 2,
            possibleConditions: ['Community-acquired pneumonia', 'Viral lower respiratory tract infection', 'Pulmonary tuberculosis'],
            recommendedAction: 'Urgent same-day clinical assessment is advised with oxygenation and chest findings reviewed promptly.',
            reasoning: 'Cough with fever and respiratory symptoms raises concern for lower respiratory infection and, in South Africa, TB remains part of the differential.',
        };
    }

    if (includesAnySymptom(text, ['burning urine', 'pain urinating', 'dysuria', 'flank pain', 'back pain']) && includesAnySymptom(text, ['fever', 'chills'])) {
        return {
            triageLevel: 3,
            possibleConditions: ['Urinary tract infection', 'Pyelonephritis', 'Renal colic with superimposed infection'],
            recommendedAction: 'Doctor should review for urinary infection severity, hydration, pregnancy status, and whether antibiotics or referral are needed.',
            reasoning: 'Urinary symptoms with fever suggest infection, with pyelonephritis remaining an important rule-out.',
        };
    }

    if (includesAnySymptom(text, ['right lower abdomen', 'right lower quadrant', 'abdominal pain']) && includesAnySymptom(text, ['fever', 'vomiting', 'nausea'])) {
        return {
            triageLevel: 2,
            possibleConditions: ['Appendicitis', 'Acute gastroenteritis', 'Pelvic or abdominal inflammatory process'],
            recommendedAction: 'Urgent same-day clinical examination is advised to exclude a surgical abdomen.',
            reasoning: 'Abdominal pain with fever and gastrointestinal symptoms needs prompt review because appendicitis cannot be excluded safely.',
        };
    }

    if (includesAnySymptom(text, ['headache', 'neck stiffness', 'stiff neck']) && includesAnySymptom(text, ['fever', 'photophobia', 'confusion'])) {
        return {
            triageLevel: 1,
            possibleConditions: ['Meningitis or meningoencephalitis', 'Severe systemic infection', 'Intracranial inflammatory process'],
            recommendedAction: 'Immediate emergency assessment is required due to possible central nervous system infection.',
            reasoning: 'Headache with fever and meningeal features is treated as an emergency because meningitis must be excluded.',
        };
    }

    if (includesAnySymptom(text, ['rash', 'itching', 'hives', 'swelling'])) {
        return {
            triageLevel: 4,
            possibleConditions: ['Allergic reaction', 'Dermatitis', 'Viral exanthem'],
            recommendedAction: 'Doctor should review exposure history, airway symptoms, and whether this is allergic, infectious, or inflammatory.',
            reasoning: 'Skin symptoms suggest an allergic or inflammatory presentation, with severity depending on airway involvement and systemic features.',
        };
    }

    if (includesAnySymptom(text, ['fever', 'body aches', 'fatigue', 'runny nose', 'cough'])) {
        return {
            triageLevel: 4,
            possibleConditions: ['Viral upper respiratory infection', 'Influenza-like illness', 'Early bacterial infection'],
            recommendedAction: 'Doctor should correlate duration, respiratory severity, hydration, and comorbidities before deciding on treatment.',
            reasoning: 'The presentation is most consistent with an infectious syndrome, likely viral, though early bacterial disease remains possible.',
        };
    }

    return {
        triageLevel: 3,
        possibleConditions: ['Acute undifferentiated illness', 'Infective or inflammatory presentation', 'Condition requiring clinician correlation'],
        recommendedAction: 'Doctor should review the presentation directly and document a provisional diagnosis after correlation with history, exam, and attachments.',
        reasoning: 'Symptoms do not map cleanly to a single fallback pattern, so a cautious clinician-reviewed provisional impression is required.',
    };
}

function hasOnlyGenericConditions(conditions: string[]): boolean {
    if (conditions.length === 0) return true;

    return conditions.every((condition) =>
        /undifferentiated|unclear|unspecified|unknown|presentation|condition requiring/i.test(condition),
    );
}

function enrichWithFallbackOpinion(candidate: TriageResult, request: TriageRequest): TriageResult {
    if (!hasOnlyGenericConditions(candidate.possibleConditions) && candidate.reasoning.trim().length >= 60) {
        return candidate;
    }

    const fallbackOpinion = deriveFallbackOpinion(request.symptoms);
    return {
        ...candidate,
        triageLevel: Math.min(candidate.triageLevel, fallbackOpinion.triageLevel) as 1 | 2 | 3 | 4 | 5,
        possibleConditions: fallbackOpinion.possibleConditions,
        recommendedAction: fallbackOpinion.recommendedAction,
        reasoning: `${candidate.reasoning} Provisional fallback impression: ${fallbackOpinion.reasoning}`.trim(),
        uncertaintyFlags: [...new Set([...candidate.uncertaintyFlags, 'HEURISTIC_PROVISIONAL_OPINION'])],
    };
}

function conservativeFallback(reason: string, symptoms: string): TriageResult {
    const fallbackOpinion = deriveFallbackOpinion(symptoms);
    return {
        triageLevel: fallbackOpinion.triageLevel,
        possibleConditions: fallbackOpinion.possibleConditions,
        recommendedAction: fallbackOpinion.recommendedAction,
        reasoning: `${fallbackOpinion.reasoning} Conservative safety fallback was used: ${reason}`,
        confidence: 0,
        uncertaintyFlags: ['AI_PROVIDER_FAILURE', 'FALLBACK_USED'],
        evidenceSources: ['Local Clinical Rules'],
        requiresDoctorReview: true,
    };
}

function mergeGuardrails(candidate: TriageResult, request: TriageRequest): TriageResult {
    const enrichedCandidate = enrichWithFallbackOpinion(candidate, request);
    const risk = assessDeterministicRisk(request.symptoms, request.vitalsSnapshot);
    const confidence = Number.
isFinite(enrichedCandidate.confidence) ? Math.max(0, Math.
min(1, enrichedCandidate.confidence)) : 0;
    const uncertaintyFlags = [...new Set(enrichedCandidate.uncertaintyFlags.filter(Boolean))];

    const mergedLevel = Math.min(enrichedCandidate.triageLevel, risk.minTriageLevel) as 1 | 2 | 3 | 4 | 5;
    const combinedFlags = [...new Set([
        ...uncertaintyFlags,
        ...risk.hardFlags,
        ...risk.cautionFlags,
    ])];

    if (confidence < 0.55) {
        combinedFlags.push('LOW_MODEL_CONFIDENCE');
    }
    if (enrichedCandidate.evidenceSources.length === 0) {
        combinedFlags.push('NO_ALLOWED_EVIDENCE_SOURCE');
    }

    const requiresDoctorReview = mergedLevel <= 2 || combinedFlags.length > 0 || confidence < 0.7;
    const actionPrefix = requiresDoctorReview
        ? 'Doctor review required before patient-facing interpretation.'
        : 'Proceed with standard doctor review workflow.';

    return {
        ...enrichedCandidate,
        triageLevel: mergedLevel,
        uncertaintyFlags: [...new Set(combinedFlags)],
        requiresDoctorReview,
        recommendedAction: `${actionPrefix} ${enrichedCandidate.recommendedAction}`.trim(),
        reasoning: `${enrichedCandidate.reasoning} | Guardrails applied: min triage ${risk.minTriageLevel}, confidence ${confidence.toFixed(2)}.`,
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
    if (typeof p?.reasoning !== 'string' || (p.reasoning as string).
trim() === '') {
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
    };
}

const TRIAGE_PROMPT_END = `{
  "triageLevel": number (1-5, where 1 is critical/ER, 5 is basic home care),
  "possibleConditions": ["string", "string"],
  "recommendedAction": "string (Advice for the patient/nurse)",
  "reasoning": "string (Brief medical reasoning)",
  "confidence": "number (0 to 1)",
  "uncertaintyFlags": ["string"],
  "evidenceSources": ["StatPearls/NCBI" | "SATS" | "WHO" | "Patient Symptoms" | "Patient Vitals" | "Patient Risk Profile"],
  "requiresDoctorReview": "boolean"
}


IMPORTANT: Do not include markdown formatting like 
\`\`\`json. Just the raw JSON.
CRITICAL SAFETY RULES:
- Case 
isolation is mandatory: never use information from any other case or prior patient.
- Use only the provided symptoms/image/context and explicit reference context.
- Do NOT use internet/general web knowledge beyond these allowed references.
- If uncertain, set low confidence, add uncertaintyFlags, and set requiresDoctorReview=true.
DISCLAIMER: This is for informational purposes only.`;

// Claude via official Anthropic API
async function analyzeWithClaude(
    request: TriageRequest,
    medicalContext?: string | null,
    patientContext?: string | null
): Promise<TriageResult> {
    if (!ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    if (DEBUG) console.log("[aiTriage] Using Claude via Anthropic API...");

    const prompt = buildTriagePrompt(request, medicalContext, patientContext) + TRIAGE_PROMPT_END;

    // Build message content
    const content: any[] = [{ type: "text", text: prompt }];

    if (request.imageBase64) {
        // Extract base64 data and mime type
        const matches = request.imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
        if (matches) {
            content.push({
                type: "image",
                source: {
                    type: "base64",
                    media_type: matches[1],
                    data: matches[2]
                }
            });
        }
    }

    const requestBody = JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
            {
                role: "user",
                content: content
            }
        ]
    });

    const response = await withResilientHttp('ai-provider-claude', async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AI_PROVIDER_TIMEOUT_MS);
        try {
            return await
 fetch("https://api.anthropic.com/v1/messages", { method: "POST",
                headers: {
                 
   "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01"
                },
                body: requestBody,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    }, {
        retries: AI_PROVIDER_RETRIES,
        timeoutMs: AI_PROVIDER_TIMEOUT_MS,
        circuitThreshold: AI_PROVIDER_CIRCUIT_THRESHOLD,
        circuitOpenMs: AI_PROVIDER_CIRCUIT_OPEN_MS,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[aiTriage] Anthropic API Error:", response.status, errorText);
        throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const data = await withTimeout(
        response.json() as Promise<{ content: { text: string }[] }>,
        AI_PROVIDER_TIMEOUT_MS,
        'claude-response-parse'
    );
    const text = data.content?.[0]?.text || "";

    // Clean markdown code blocks if present
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    if (DEBUG) console.log("[aiTriage] Claude response received");

    return validateTriageResult(JSON.parse(cleanJson), 'Claude');
}

// Gemini
async function analyzeWithGemini(
    request: TriageRequest,
    medicalContext?: string | null,
    patientContext?: string | null
): Promise<TriageResult> {
    if (!genAI) {
        throw new Error("GEMINI_API_KEY is not configured");
    }

    if (DEBUG) console.log("[aiTriage] Using Gemini...");

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = buildTriagePrompt(request, medicalContext, patientContext) + TRIAGE_PROMPT_END;

    const parts: any[] = [prompt];

    if (request.imageBase64) {
        const mimeMatch = request.imageBase64.match(/^data:(image\/\w+);base64,/);
        const detectedMimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const supportedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
        const safeMimeType = supportedMimeTypes.includes(detectedMimeType) ? detectedMimeType : 'image/jpeg';
        const cleanBase64 = request.imageBase64.replace(/^data:image\/\w+;base64,/, "");
        parts.push({
            inlineData: {
                data: cleanBase64,
                mimeType: safeMimeType,
            },
        });
    }

    const result = await withResilientHttp('ai-provider-gemini', () =>
        withTimeout(model.generateContent(parts), AI_PROVIDER_TIMEOUT_MS, 'gemini-generate'),
        {
            retries: AI_PROVIDER_RETRIES,
            timeoutMs: AI_PROVIDER_TIMEOUT_MS,
            circuitThreshold: AI_PROVIDER_CIRCUIT_THRESHOLD,
            circuitOpenMs: AI_PROVIDER_CIRCUIT_OPEN_MS,
        }
    );
    const response = result.response;
    const text = response.text();

    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    if (DEBUG) console.log("[aiTriage] Gemini response received");

    return validateTriageResult(JSON.parse(cleanJson), 'Gemini');
}

// Main function with fallback logic
export async function analyzeSymptoms(request: TriageRequest): Promise<TriageResult> {
    const normalizedRequest: TriageRequest = {
        ...request,
        symptoms: normalizeSymptoms(request.symptoms),
    };

    if (DEBUG) {
        console.log(`[aiTriage] analyzeSymptoms called caseId=${normalizedRequest.caseId ?? 'n/a'} patientContext=${!!normalizedRequest.patientContext}`);
    }

    const dedupeKey = buildInFlightKey(normalizedRequest);
    const existing = inFlightTriage.get(dedupeKey);
    if (existing) {
        if (DEBUG) console.log('[aiTriage] Reusing in-flight triage computation for identical request');
        return existing;
    }

    const work = (async (): Promise<TriageResult> => {
      //Fetch medical context from all enabled evidence providers
      const combinedEvidence = await combineEvidence({
        symptoms: normalizedRequest.symptoms,
        imageBase64: normalizedRequest.imageBase64,
        patientContext: normalizedRequest.patientContext,
      });

      const hasEvidence = hasSufficientEvidence(combinedEvidence);
      const evidenceSummary = getEvidenceSummary(combinedEvidence);

      if (DEBUG) {
        console.log('[aiTriage] Evidence sources:', evidenceSummary,
          ', queried:', combinedEvidence.sourcesQueried.join(', '),
          ', succeeded:', combinedEvidence.sourcesSucceeded.join(', '));
      }

      // Build medical context from evidence results
      let medicalContext: string | null = null;
      if (combinedEvidence.results.length > 0) {
        medicalContext = combinedEvidence.results.map(r =>
          '\n\n## ' + r.sourceId.toUpperCase() + ' Reference\n' +
          'Citation: ' + r.citation + '\n' +
          r.content
        ).join('');
        if (DEBUG) console.log('[aiTriage] Evidence context assembled (' + medicalContext.length + ' chars)');
      }
      const patientCtx = normalizedRequest.patientContext ?? null;
        let candidate: TriageResult | null = null;

        // Try Claude first (primary)
        if (ANTHROPIC_API_KEY) {
            try {
                candidate = await analyzeWithClaude(normalizedRequest, medicalContext, patientCtx);
            } catch (error: any) {
                console.warn(`[aiTriage] Claude failed: ${error.message}`);

                // If rate limited (429), try Gemini
                if (error.status === 429 || error.message?.includes("429")) {
                    if (DEBUG) console.log("[aiTriage] Claude rate limited, falling back to Gemini...");
                } else {
                    if (DEBUG) console.log("[aiTriage] Claude error, falling back to Gemini...");
              
  }
            }
        }

        // Fallback to Gemini
        if (!candidate && genAI) {
            try {
                candidate = await analyzeWithGemini(normalizedRequest, medicalContext, patientCtx);
            } catch (error: any) {
                console.error(`[aiTriage] Gemini also failed: ${error.message}`);
            }
        }

      const hasPeerReviewedContext = hasEvidence;

        if (!candidate) {
            const fallback = conservativeFallback(
                !ANTHROPIC_API_KEY && !genAI
                    ? 'No AI provider configured'
                    : 'All configured AI providers failed'
                ,
                normalizedRequest.symptoms,
            );
            const guardedFallback = mergeGuardrails(fallback, normalizedRequest);
            guardedFallback.uncertaintyFlags = [...new Set([
                ...guardedFallback.uncertaintyFlags,
                'NO_PEER_REVIEW_CONTEXT',
            ])];
            // If we have no evidence at all, this is a critical gap
            if (!hasEvidence) {
                guardedFallback.uncertaintyFlags.push('NO_EVIDENCE_SOURCES_AVAILABLE');
                guardedFallback.requiresDoctorReview = true;
            }
            guardedFallback.requiresDoctorReview = true;
            return guardedFallback;
        }

        const guarded = mergeGuardrails(candidate, normalizedRequest);
        if (!hasEvidence) {
            guarded.confidence = Math.min(guarded.confidence, 0.5);
            guarded.uncertaintyFlags = [...new Set([
                ...guarded.uncertaintyFlags,
                'NO_PEER_REVIEW_CONTEXT',
            ])];
            guarded.requiresDoctorReview = true;
        }
        return guarded;
    })();

    inFlightTriage.set(dedupeKey, work);
    try {
        return await work;
    } finally {
        inFlightTriage.delete(dedupeKey);
    }
}
