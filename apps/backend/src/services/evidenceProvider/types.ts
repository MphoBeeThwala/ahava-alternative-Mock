// Evidence Provider Interface
// Abstraction layer for all clinical evidence sources
// All sources implement this interface for consistent integration

// 'context' (AH-46 gap report): locally-held reference data with no network
// dependency (e.g. the SA epidemiological fact-sheet). Genuinely useful to
// inject into model context, but must never satisfy hasSufficientEvidence —
// it's always present regardless of whether any real external source is up.
export type EvidenceTier = 'structural' | 'literature' | 'engine' | 'image' | 'context';

// AH-46 gap report: thrown by a provider's network/HTTP layer specifically
// (a non-2xx response, a timeout, a DNS/connection failure) so combineEvidence
// can record a genuine outage in sourcesFailed. Providers still return an
// empty array — not throw — for a call that succeeded but simply found no
// matching results; that's not a failure.
export class EvidenceProviderNetworkError extends Error {
  constructor(public readonly providerId: string, detail: string) {
    super(`[${providerId}] network/HTTP failure: ${detail}`);
    this.name = 'EvidenceProviderNetworkError';
  }
}

export interface EvidenceProviderConfig {
  id: string;
  tier: EvidenceTier;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  weight?: number; // Ranking weight (0-1)
}

export interface ClinicalQuery {
  symptoms: string;
  patientContext?: string;
  vitals?: any;
  imageBase64?: string;
  icd11Codes?: string[]; // Normalized codes from structural sources
}

export interface EvidenceResult {
  sourceId: string;
  content: string; // Paraphrased/structured, never raw copyrighted text
  citation: string; // Exact reference for audit trail
  confidence?: number; // Provider's own confidence (0-1)
  retrievedAt: string; // ISO timestamp
  icd11Codes?: string[]; // Codes extracted/normalized by this source
}

export interface EvidenceProvider {
  id: string;
  tier: EvidenceTier;
  config: EvidenceProviderConfig;
  
  /**
   * Query the evidence source for relevant clinical information
   * @param query - Clinical query with symptoms, context, vitals, etc.
   * @returns Array of evidence results (can be empty if nothing found)
   */
  query(query: ClinicalQuery): Promise<EvidenceResult[]>;
  
  /**
   * Health check - verify the source is accessible
   */
  healthCheck?(): Promise<boolean>;
  
  /**
   * Normalize terms to ICD-11 codes (for structural sources)
   */
  normalizeToICD11?(terms: string[]): Promise<string[]>;
}

// Provider registry type
export type EvidenceProviderRegistry = Map<string, EvidenceProvider>;

// Combined evidence from all sources
export interface CombinedEvidence {
  results: EvidenceResult[];
  sourcesQueried: string[];
  sourcesSucceeded: string[];
  sourcesFailed: string[];
  icd11Codes: string[]; // All normalized codes from all sources
  hasStructuralEvidence: boolean;
  hasLiteratureEvidence: boolean;
  hasEngineEvidence: boolean;
  hasImageEvidence: boolean;
}
