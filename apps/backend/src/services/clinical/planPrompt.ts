/**
 * Prompt sections for the structured clinical plan: the facts code computed,
 * the test limitations that apply, the questions the case asks, the elements
 * the plan must cover, and the output contract. Also the single repair prompt.
 */
import { renderChecksForPrompt, type ClinicalChecks } from './clinicalChecks';
import type { RequiredElement } from './completenessLinter';
import { renderTestLimitations, type TestLimitation } from './referenceData';

export const PLAN_JSON_TEMPLATE = `{
  "triageLevel": number (SATS 1-5; 1 = resuscitation),
  "triageConfidence": number (0-1, how sure you are of the URGENCY),
  "severity": { "summary": "string (why this urgency)", "redFlags": ["string"] },
  "leadingDiagnosis": {
    "name": "string",
    "probability": number (0-1, how likely this is the diagnosis),
    "confirmationStatus": "microbiologically_confirmed" | "tissue_confirmed" | "clinical_only",
    "rationale": "string (cite the supplied findings)"
  },
  "differential": [
    { "name": "string", "probability": number (0-1), "evidenceFor": ["string"], "evidenceAgainst": ["string (or 'none identified')"] }
  ],
  "mustNotMiss": [ { "name": "string", "why": "string", "howToExclude": "string" } ],
  "investigations": {
    "bedsideStat": [ { "test": "string", "rationale": "string" } ],
    "first24h": [ { "test": "string", "rationale": "string" } ],
    "definitive": [ { "test": "string", "rationale": "string" } ]
  },
  "management": {
    "immediate": [ { "action": "string", "rationale": "string", "guidelineSource": "string" } ],
    "targeted": [ { "action": "string", "rationale": "string", "guidelineSource": "string" } ],
    "supportive": [ { "action": "string", "rationale": "string", "guidelineSource": "string" } ]
  },
  "existingTreatmentDecisions": [ { "treatment": "string", "decision": "continue" | "stop" | "modify", "reason": "string" } ],
  "timingDecisions": [ { "topic": "string (for example ART initiation)", "recommendation": "string", "reason": "string" } ],
  "prophylaxis": [ { "agent": "string", "indication": "string" } ],
  "escalation": { "escalateIf": ["string"], "redFlags": ["string"], "referral": ["string"] },
  "questionAnswers": [ { "question": "string (copied from the list above)", "answer": "string" } ],
  "evidenceSources": ["StatPearls/NCBI" | "SATS" | "WHO" | "Patient Symptoms" | "Patient Vitals" | "Patient Risk Profile"],
  "uncertaintyFlags": ["string"]
}`;

export interface PlanPromptInput {
  checks: ClinicalChecks;
  limitations: TestLimitation[];
  questions: string[];
  required: RequiredElement[];
}

export function buildPlanPromptSections(i: PlanPromptInput): string {
  const parts: string[] = [];

  parts.push(`DETERMINISTIC CLINICAL CHECKS (computed by code from the structured values; treat as facts, never contradict them):
${renderChecksForPrompt(i.checks)}
- "NOT ASSESSABLE" means a needed input is unknown, NOT that the criterion is absent. Where it matters, put the missing measurement in investigations.bedsideStat.
- Do not state that the patient is in septic shock unless the Sepsis-3 line above says MET.`);

  if (i.limitations.length > 0) {
    parts.push(`TEST LIMITATIONS THAT APPLY TO THIS CASE (a negative result is not always an exclusion):
${renderTestLimitations(i.limitations)}`);
  }

  if (i.questions.length > 0) {
    parts.push(`QUESTIONS THE CASE ASKS. Answer every one explicitly in "questionAnswers", in this order, copying the question text:
${i.questions.map((q, n) => `${n + 1}. ${q}`).join('\n')}`);
  }

  if (i.required.length > 0) {
    parts.push(`THE PLAN MUST ADDRESS (a checklist triggered by this case; each item needs an explicit statement in the right section, even if the answer is "not indicated, because ..."):
${i.required.map((r) => `- [${r.ruleTitle}] ${r.description}`).join('\n')}`);
  }

  parts.push(`CLINICAL PLAN RULES:
- Use South African guidelines as the default reference: NDoH (National Department of Health) guidelines, the Standard Treatment Guidelines and Essential Medicines List, and the Southern African HIV Clinicians Society guidelines. In "guidelineSource" name only a guideline you are sure exists; otherwise write "SA guideline: verify".
- NEVER write a drug dose, frequency or quantity (no "mg", "g", "mL", "units", "per kg"). Name the drug, formulation and route only. Doses are added from a reviewed table by the clinician view.
- Investigations are tiered: bedsideStat (minutes, at the bedside or point of care), first24h, definitive (confirms the diagnosis, for example tissue or culture).
- Management is tiered: immediate (life-saving, now), targeted (aimed at the leading diagnosis), supportive.
- existingTreatmentDecisions: for EVERY treatment the patient is already on that matters here, give an explicit continue, stop or modify with the reason. A negative test does not by itself justify stopping.
- timingDecisions: state timing explicitly where timing is a real decision (for example when to start ART relative to the infection being treated).
- "confirmationStatus" is "clinical_only" unless the case text states a positive culture, antigen/PCR result or histology for the leading diagnosis.
- Probabilities express genuine uncertainty. Do not give the leading diagnosis a high probability while two or more alternatives remain plausible.
- Only recommend what the supplied findings support; where information is missing, say what to measure.`);

  return parts.join('\n\n');
}

export interface RepairInput {
  originalPrompt: string;
  previousAnswer: string;
  issues: string[];
}

/** One targeted re-prompt: the same task, the previous answer, and exactly what is wrong with it. */
export function buildRepairPrompt(r: RepairInput): string {
  return `${r.originalPrompt}

---
YOUR PREVIOUS ANSWER (for correction):
${r.previousAnswer}

PROBLEMS FOUND IN YOUR PREVIOUS ANSWER (fix every one; keep everything that was correct):
${r.issues.map((x, n) => `${n + 1}. ${x}`).join('\n')}

Return the COMPLETE corrected JSON object in the same structure as before. Output only the raw JSON object.`;
}
