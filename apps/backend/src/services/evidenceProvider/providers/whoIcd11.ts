/**
 * WHO ICD-11 API Provider
 * Tier: structural
 * Purpose: Normalize symptoms, diagnoses, and risk flags to canonical ICD-11 codes
 */

import { EvidenceProvider, EvidenceProviderConfig, ClinicalQuery, EvidenceResult } from '../types';

interface ICD11SearchResult {
  destinationTitle: string;
  destinationUri: string;
  title: string;
  uri: string;
}

/**
 * WHO ICD-11 Provider
 * Uses the free RESTful API to search and retrieve ICD-11 codes
 */
export function whoIcd11Provider(config: EvidenceProviderConfig): EvidenceProvider {
  const baseUrl = config.baseUrl || 'https://icd11rest.who.int';
  const timeoutMs = config.timeoutMs || 5000;

  return {
    id: config.id,
    tier: 'structural',
    config,

    async query(query: ClinicalQuery): Promise<EvidenceResult[]> {
      const symptoms = query.symptoms || '';
      const icd11Codes = await this.normalizeToICD11?.([symptoms]) || [];

      if (icd11Codes.length > 0) {
        return [{
          sourceId: 'who-icd11',
          content: 'Normalized to ICD-11 codes: ' + icd11Codes.join(', '),
          citation: 'WHO ICD-11 International Classification of Diseases 11th Revision',
          confidence: 1.0,
          retrievedAt: new Date().toISOString(),
          icd11Codes,
        }];
      }

      return [];
    },

    async normalizeToICD11(terms: string[]): Promise<string[]> {
      const codes: string[] = [];

      for (const term of terms) {
        try {
          const code = await searchICD11(term, baseUrl, timeoutMs);
          if (code) {
            codes.push(code);
          }
        } catch (error: any) {
          console.warn('[WHO-ICD11] Failed to normalize term "' + term + '":', error.message);
        }
      }

      return codes;
    },

    async healthCheck(): Promise<boolean> {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(baseUrl + '/icd/release/11/2024-01', {
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

async function searchICD11(term: string, baseUrl: string, timeoutMs: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const searchUrl = baseUrl + '/icd/search?q=' + encodeURIComponent(term) + '&limit=5';
    const response = await fetch(searchUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json();

    if (!data.destinationEntities || data.destinationEntities.length === 0) {
      return null;
    }

    const firstResult = data.destinationEntities[0];
    const uri = firstResult.destinationUri || firstResult.uri || '';

    // URI format: /icd/release/11/2024-01/mms/12345678
    const codeMatch = uri.match(/\/mms\/([A-Z0-9]+)/);
    if (codeMatch) {
      return codeMatch[1];
    }

    return null;
  } catch (error: any) {
    console.warn('[WHO-ICD11] Search failed for term "' + term + '":', error.message);
    return null;
  }
}
