import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import { getMedicalContext } from './statPearls';

dotenv.config();

// API Keys
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

console.log(`[aiTriage] GEMINI_API_KEY present: ${!!GEMINI_API_KEY}`);
console.log(`[aiTriage] ANTHROPIC_API_KEY present: ${!!ANTHROPIC_API_KEY}`);

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

export interface TriageRequest {
    symptoms: string;
    imageBase64?: string; // Optional image of the condition
}

export interface TriageResult {
    triageLevel: 1 | 2 | 3 | 4 | 5; // 1 = Resuscitation, 5 = Non-urgent
    possibleConditions: string[];
    recommendedAction: string;
    reasoning: string;
}

const SA_CLINICAL_SYSTEM_CONTEXT = `You are a clinical decision support assistant operating in South Africa. You use the South African Triage Scale (SATS).

SOUTH AFRICAN DISEASE BURDEN — always factor into differential diagnosis:
- TB: Highest global incidence (322/100,000). Include in ALL respiratory/fever/weight-loss differentials. GeneXpert MTB/RIF is SA first-line test.
- HIV: 13.7% adult prevalence. Consider in immunocompromised presentations, unusual infections, wasting.
- Rheumatic heart disease: Remains prevalent in patients <40 — unlike high-income countries. Consider in chest pain/valve murmur/dyspnoea in young patients.
- Malaria: Endemic in Limpopo, Mpumalanga, KZN lowveld — ask about location/travel. Use rapid malaria test.
- Tick-bite fever (Rickettsia conorii): Common cause of fever+rash+eschar in SA.
- Cryptococcal meningitis: Common in HIV+ patients with CD4 <100 presenting with headache.
- Hypertension: 46% adult prevalence — consider in all cardiac, renal, neurological presentations.
- Hypoglycaemia: Common in diabetic patients on oral agents or insulin.
- Anaemia: High prevalence — iron deficiency, B12/folate, haemolytic (malaria).

SATS TRIAGE LEVELS (use these exact levels — NOT Manchester Triage):
- Level 1 (Red/Immediate): Airway compromise, unresponsive/GCS<9, systolic BP<80, SpO2<85%, active seizure, major haemorrhage
- Level 2 (Orange/Very Urgent): Severe pain (7-10/10), SpO2 85-92%, systolic BP 80-90, altered consciousness, chest pain with risk factors
- Level 3 (Yellow/Urgent): Moderate distress, SpO2 93-95%, abnormal vitals not critical, persistent vomiting, fever >39°C
- Level 4 (Green/Less Urgent): Minor illness/injury, stable vitals, ambulatory, no red flags
- Level 5 (Blue/Non-Urgent): Chronic stable condition, prescription refill, minor complaint <24h

EMERGENCY REFERRAL: For Level 1-2, ALWAYS include "Call 10177 (ambulance) immediately" in recommendedAction.

MANDATORY DISCLAIMER: Always end reasoning with: "⚠️ This is a clinical decision support tool only. A registered healthcare professional must examine the patient before diagnosis or treatment."`;

function buildTriagePrompt(symptoms: string, medicalContext?: string | null): string {
    const basePrompt = `${SA_CLINICAL_SYSTEM_CONTEXT}

Analyze the following patient symptoms and (optional) image.

PATIENT SYMPTOMS: "${symptoms}"`;

    const contextSection = medicalContext
        ? `

PEER-REVIEWED REFERENCE (from StatPearls / SA clinical guidelines — use to inform assessment, do not copy verbatim):
${medicalContext}

`
        : "\n";

    return `${basePrompt}${contextSection}
Output ONLY valid JSON with the following structure:`;
}

const TRIAGE_PROMPT_END = `{
  "triageLevel": number (1-5 using SATS scale, where 1=Immediate/Red, 5=Non-urgent/Blue),
  "possibleConditions": ["string", "string"],
  "recommendedAction": "string (specific action for patient/nurse — include 10177 for Level 1-2)",
  "reasoning": "string (clinical reasoning including relevant SA disease context)"
}

IMPORTANT: Output raw JSON only. No markdown code blocks. No extra text before or after the JSON.
DISCLAIMER: Clinical decision support only. Not a diagnosis.`;

// Claude via official Anthropic API
async function analyzeWithClaude(
    request: TriageRequest,
    medicalContext?: string | null
): Promise<TriageResult> {
    if (!ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    console.log("[aiTriage] Using Claude via Anthropic API...");

    const prompt = buildTriagePrompt(request.symptoms, medicalContext) + TRIAGE_PROMPT_END;

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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            messages: [
                {
                    role: "user",
                    content: content
                }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[aiTriage] Anthropic API Error:", response.status, errorText);
        throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { content: { text: string }[] };
    const text = data.content?.[0]?.text || "";

    // Clean markdown code blocks if present
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    console.log("[aiTriage] Claude response received successfully");

    return JSON.parse(cleanJson) as TriageResult;
}

// Gemini
async function analyzeWithGemini(
    request: TriageRequest,
    medicalContext?: string | null
): Promise<TriageResult> {
    if (!genAI) {
        throw new Error("GEMINI_API_KEY is not configured");
    }

    console.log("[aiTriage] Using Gemini...");

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = buildTriagePrompt(request.symptoms, medicalContext) + TRIAGE_PROMPT_END;

    const parts: any[] = [prompt];

    if (request.imageBase64) {
        const cleanBase64 = request.imageBase64.replace(/^data:image\/\w+;base64,/, "");
        parts.push({
            inlineData: {
                data: cleanBase64,
                mimeType: "image/jpeg",
            },
        });
    }

    const result = await model.generateContent(parts);
    const response = await result.response;
    const text = response.text();

    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    console.log("[aiTriage] Gemini response received successfully");

    return JSON.parse(cleanJson) as TriageResult;
}

// Main function with fallback logic
export async function analyzeSymptoms(request: TriageRequest): Promise<TriageResult> {
    console.log(`[aiTriage] analyzeSymptoms called`);

    // Fetch StatPearls medical context (Option A - Proxy/Context Injection)
    let medicalContext: string | null = null;
    try {
        medicalContext = await getMedicalContext(request.symptoms);
        if (medicalContext) {
            console.log(`[aiTriage] StatPearls context fetched (${medicalContext.length} chars)`);
        }
    } catch (err) {
        console.warn("[aiTriage] StatPearls context fetch failed, proceeding without:", err);
    }

    // Try Claude first (primary)
    if (ANTHROPIC_API_KEY) {
        try {
            return await analyzeWithClaude(request, medicalContext);
        } catch (error: any) {
            console.warn(`[aiTriage] Claude failed: ${error.message}`);

            // If rate limited (429), try Gemini
            if (error.status === 429 || error.message?.includes("429")) {
                console.log("[aiTriage] Claude rate limited, falling back to Gemini...");
            } else {
                console.log("[aiTriage] Claude error, falling back to Gemini...");
            }
        }
    }

    // Fallback to Gemini
    if (genAI) {
        try {
            return await analyzeWithGemini(request, medicalContext);
        } catch (error: any) {
            console.error(`[aiTriage] Gemini also failed: ${error.message}`);
            throw new Error("Both AI providers failed. Please try again later.");
        }
    }

    throw new Error("No AI provider configured. Please set ANTHROPIC_API_KEY or GEMINI_API_KEY.");
}
