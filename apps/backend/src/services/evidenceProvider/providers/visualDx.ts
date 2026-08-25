/**
 * VisualDx API Provider
 * Tier: image
 * Purpose: Image differential diagnosis for photo-upload flow
 * 
 * IMPORTANT: This provider is DISABLED by default.
 * - Requires commercial agreement before activation
 * - DO NOT activate for real patients until funded and contract signed
 * 
 * Design notes:
 * - Used for the photo-upload flow
 * - Returns curated differential in addition to Claude's visual reasoning
 * - Both results presented to reviewing clinician
 * - Until activated, image-based assessments from Claude alone carry stronger mandatory-doctor-review flag
 */

import { EvidenceProvider, EvidenceProviderConfig, ClinicalQuery, EvidenceResult } from '../types';

interface VisualDxRequest {
  patient: {
    age: number;
    sex: 'M' | 'F' | 'U';
    skinType?: string;
  };
  encounter: {
    chiefComplaint: string;
    images: {
      data: string; // base64 encoded image
      mediaType: string;
    }[];
  };
  extras?: {
    specialties?: string[];
    quickList?: boolean;
  };
}

interface VisualDxResponse {
  results: {
    name: string;
    diagnosis: {
      name: string;
      id: string;
      probability: number;
      findings: {
        name: string;
        id: string;
      }[];
    }[];
    observations: {
      name: string;
      id: string;
    }[];
  }[];
  meta: {
    searchId: string;
    modelVersion: string;
  };
}

/**
 * VisualDx Provider
 * Returns image-based differential diagnosis
 */
export function visualDxProvider(config: EvidenceProviderConfig): EvidenceProvider {
  const baseUrl = config.baseUrl || 'https://api.visualdx.com/v1';
  const apiKey = config.apiKey || process.env.VISUALDX_API_KEY || '';
  const timeoutMs = config.timeoutMs || 15000;

  return {
    id: config.id,
    tier: 'image',
    config,

    async query(query: ClinicalQuery): Promise<EvidenceResult[]> {
      if (!apiKey) {
        console.warn('[VisualDx] API key not configured');
        return [];
      }

      const imageBase64 = query.imageBase64;
      
      // This provider only works with images
      if (!imageBase64) {
        return [];
      }

      try {
        // Extract base64 data and mime type
        const matches = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!matches) {
          console.warn('[VisualDx] Invalid image format');
          return [];
        }

        const mimeType = matches[1];
        const imageData = matches[2];

        // Build request
        const request: VisualDxRequest = {
          patient: {
            age: 45, // Default age
            sex: 'U', // Unknown
          },
          encounter: {
            chiefComplaint: query.symptoms || 'Unknown',
            images: [{
              data: imageData,
              mediaType: mimeType,
            }],
          },
          extras: {
            quickList: true,
          },
        };

        // Call VisualDx API
        const response = await callVisualDx(request, baseUrl, apiKey, timeoutMs);
        
        if (!response || !response.results || response.results.length === 0) {
          return [];
        }

        // Convert response to EvidenceResult
        const results: EvidenceResult[] = [];
        const topResult = response.results[0];
        
        if (topResult.diagnosis && topResult.diagnosis.length > 0) {
          const topDiagnoses = topResult.diagnosis.slice(0, 3);
          const diagnosisNames = topDiagnoses.map(d => d.name).join(', ');
          const avgProbability = topDiagnoses.reduce((sum, d) => sum + (d.probability || 0), 0) / topDiagnoses.length;
          
          results.push({
            sourceId: 'visualdx',
            content: 'VisualDx Image Analysis: Top diagnoses - ' + diagnosisNames + '. Average probability: ' + (avgProbability * 100).toFixed(1) + '%' + (topResult.observations?.length ? ' Observations: ' + topResult.observations.map(o => o.name).join(', ') : ''),
            citation: 'VisualDx API v1 - Search ID: the above',
            confidence: avgProbability,
            retrievedAt: new Date().toISOString(),
          });
        }

        return results;
      } catch (error: any) {
        console.warn('[VisualDx] Query failed:', error.message);
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
            'Authorization': 'Bearer ' + apiKey,
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
 * Call VisualDx API
 */
async function callVisualDx(
  request: VisualDxRequest,
  baseUrl: string,
  apiKey: string,
  timeoutMs: number
): Promise<VisualDxResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const url = baseUrl + '/diagnosis';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn('[VisualDx] API error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json() as VisualDxResponse;
    return data;
  } catch (error: any) {
    console.warn('[VisualDx] API call failed:', error.message);
    return null;
  }
}

/**
 * Helper function to check if VisualDx is enabled
 */
export function isVisualDxEnabled(): boolean {
  return false; // Always disabled until funded
}
