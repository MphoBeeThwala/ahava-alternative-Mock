/**
 * Infermedica Engine API Provider
 * Tier: engine
 * Purpose: Symptom-side triage engine as independent second opinion
 * 
 * IMPORTANT: This provider is DISABLED by default.
 * - Infermedica has no public self-serve pricing
 * - Trial account capped at 2,000 calls / 60 days, explicitly non-commercial
 * - Production use requires signed enterprise agreement
 * - DO NOT activate for real patients until contract exists
 * 
 * Design notes:
 * - Stateless: does not accept patient-identifying data
 * - Only receives de-identified symptom sets
 * - All patient-history linkage stays in our database and gets re-attached after call returns
 * - Output is a second, independently-produced triage opinion
 */

import { EvidenceProvider, EvidenceProviderConfig, ClinicalQuery, EvidenceResult } from '../types';

interface InfermedicaRequest {
  sex: 'male' | 'female' | 'unknown';
  age: { value: number; unit: 'year' };
  evidence: {
    choice_id: string;
    source: 'initial' | 'suggested';
    observations?: {
      id: string;
      choice_id: string;
    }[];
  }[];
  extras?: {
    disable_groups?: string;
    enable_groups?: string;
  };
}

interface InfermedicaResponse {
  question: {
    type: string;
    text: string;
    items: {
      id: string;
      name: string;
      choices: {
        id: string;
        label: string;
      }[];
    }[];
  };
  conditions: {
    id: string;
    name: string;
    common_name: string;
    sex_filter: ('male' | 'female')[] | null;
    category: string;
    probability: number;
    triage_level: 'emergency' | 'self_care' | 'telemedicine' | 'in_person';
  }[];
  should_stop: boolean;
  explanation?: string;
}

/**
 * Infermedica Provider
 * Returns independent triage opinion as evidence
 */
export function infermedicaProvider(config: EvidenceProviderConfig): EvidenceProvider {
  const baseUrl = config.baseUrl || 'https://api.infermedica.com/v3';
  const apiKey = config.apiKey || process.env.INFERMEDICA_API_KEY || '';
  const timeoutMs = config.timeoutMs || 10000;

  return {
    id: config.id,
    tier: 'engine',
    config,

    async query(query: ClinicalQuery): Promise<EvidenceResult[]> {
      // This provider is for symptom triage, not for general evidence
      // It returns a second opinion, not grounding text
      
      if (!apiKey) {
        console.warn('[Infermedica] API key not configured');
        return [];
      }

      try {
        const symptoms = query.symptoms || '';
        
        // Map symptoms to Infermedica evidence format
        // Note: This is a simplified mapping - full implementation would need
        // a comprehensive symptom-to-evidence-id mapping
        const evidence = mapSymptomsToEvidence(symptoms);
        
        if (evidence.length === 0) {
          return [];
        }

        // Build request
        const request: InfermedicaRequest = {
          sex: 'unknown',
          age: { value: 45, unit: 'year' }, // Default age, can be customized
          evidence,
          extras: {
            disable_groups: 'initial',
          },
        };

        // Call Infermedica API
        const response = await callInfermedica(request, baseUrl, apiKey, timeoutMs);
        
        if (!response || !response.conditions) {
          return [];
        }

        // Convert response to EvidenceResult
        const results: EvidenceResult[] = [];
        
        // Add conditions as evidence
        if (response.conditions.length > 0) {
          const topConditions = response.conditions.slice(0, 3);
          const conditionNames = topConditions.map(c => c.name || c.common_name).join(', ');
          const triageLevel = topConditions[0]?.triage_level || 'telemedicine';
          
          results.push({
            sourceId: 'infermedica',
            content: 'Infermedica Engine Assessment: Possible conditions - ' + conditionNames + 
              '. Triage level: ' + triageLevel + '.',
            citation: 'Infermedica Engine API v3',
            confidence: topConditions[0]?.probability || 0.5,
            retrievedAt: new Date().toISOString(),
          });
        }

        // Add explanation if available
        if (response.explanation) {
          results.push({
            sourceId: 'infermedica',
            content: 'Engine explanation: ' + response.explanation,
            citation: 'Infermedica Engine API v3',
            confidence: 0.7,
            retrievedAt: new Date().toISOString(),
          });
        }

        return results;
      } catch (error: any) {
        console.warn('[Infermedica] Query failed:', error.message);
        return [];
      }
    },

    async healthCheck(): Promise<boolean> {
      if (!apiKey) {
        return false;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const url = baseUrl + '/ping';
        const response = await fetch(url, {
          headers: {
            'App-Id': 'ahava-healthcare',
            'App-Key': apiKey,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);
        return response.ok;
      } catch (error) {
        return false;
      }
    },
  };
}

/**
 * Map symptoms to Infermedica evidence IDs
 * This is a simplified mapping - full implementation would need comprehensive mapping
 */
function mapSymptomsToEvidence(symptoms: string): { choice_id: string; source: 'initial' }[] {
  const symptomMap: Record<string, string> = {
    'chest pain': 's_127',
    'shortness of breath': 's_26',
    'dyspnea': 's_26',
    'cough': 's_33',
    'fever': 's_49',
    'headache': 's_135',
    'fatigue': 's_84',
    'dizziness': 's_68',
    'nausea': 's_156',
    'vomiting': 's_223',
    'abdominal pain': 's_7',
    'back pain': 's_15',
    'diarrhea': 's_62',
    'constipation': 's_52',
    'weight loss': 's_243',
    'night sweats': 's_160',
    'haemoptysis': 's_130',
    'blue lips': 's_206',
    'seizure': 's_199',
    'stroke': 's_210',
    'unconscious': 's_220',
    'unresponsive': 's_220',
  };

  const evidence: { choice_id: string; source: 'initial' }[] = [];
  const lowerSymptoms = symptoms.toLowerCase();

  for (const [symptom, choiceId] of Object.entries(symptomMap)) {
    if (lowerSymptoms.includes(symptom)) {
      evidence.push({ choice_id: choiceId, source: 'initial' });
    }
  }

  return evidence;
}

/**
 * Call Infermedica API
 */
async function callInfermedica(
  request: InfermedicaRequest,
  baseUrl: string,
  apiKey: string,
  timeoutMs: number
): Promise<InfermedicaResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const url = baseUrl + '/diagnosis';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'App-Id': 'ahava-healthcare',
        'App-Key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn('[Infermedica] API error:', response.status, response.statusText);
      return null;
    }

    const data: InfermedicaResponse = await response.json();
    return data;
  } catch (error: any) {
    console.warn('[Infermedica] API call failed:', error.message);
    return null;
  }
}

/**
 * Helper function to check if Infermedica is enabled
 */
export function isInfermedicaEnabled(): boolean {
  return false; // Always disabled until commercial agreement in place
}
