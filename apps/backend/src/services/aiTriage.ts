import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

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

const TRIAGE_PROMPT = `Act as a strictly objective medical triage assistant. 
Analyze the following symptoms and (optional) image.

SYMPTOMS: "{SYMPTOMS}"

Output ONLY valid JSON with the following structure:
{
  "triageLevel": number (1-5, where 1 is critical/ER, 5 is basic home care),
  "possibleConditions": ["string", "string"],
  "recommendedAction": "string (Advice for the patient/nurse)",
  "reasoning": "string (Brief medical reasoning)"
}

IMPORTANT: Do not include markdown formatting like \`\`\`json. Just the raw JSON.
DISCLAIMER: This is for informational purposes only.`;

// Claude via official Anthropic API
async function analyzeWithClaude(request: TriageRequest): Promise<TriageResult> {
    if (!ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    console.log("[aiTriage] Using Claude via Anthropic API...");

    const prompt = TRIAGE_PROMPT.replace("{SYMPTOMS}", request.symptoms);

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

// Gemini primary
async function analyzeWithGemini(request: TriageRequest): Promise<TriageResult> {
    if (!genAI) {
        throw new Error("GEMINI_API_KEY is not configured");
    }

    console.log("[aiTriage] Using Gemini...");

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = TRIAGE_PROMPT.replace("{SYMPTOMS}", request.symptoms);

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

    // Try Claude first (primary)
    if (ANTHROPIC_API_KEY) {
        try {
            return await analyzeWithClaude(request);
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
            return await analyzeWithGemini(request);
        } catch (error: any) {
            console.error(`[aiTriage] Gemini also failed: ${error.message}`);
            throw new Error("Both AI providers failed. Please try again later.");
        }
    }

    throw new Error("No AI provider configured. Please set ANTHROPIC_API_KEY or GEMINI_API_KEY.");
}
