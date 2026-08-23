/**
 * Evidence Combiner
 * Queries all enabled evidence providers and combines results
 * Implements ranking/weighting logic for source quality
 */

import { 
  EvidenceProvider, 
  ClinicalQuery, 
  EvidenceResult, 
  CombinedEvidence,
  getEnabledProviders,
  isProviderEnabled
} from './';

// Source ranking weights (0-1, higher = more trusted)
const SOURCE_WEIGHTS: Record<string, number> = {
  'who-icd11': 1.0,      // Structural - highest priority for normalization
  'africa-cdc': 0.95,    // SA-specific - high priority
  'pubmed': 0.9,         // Peer-reviewed literature
  'statpearls': 0.8,     // Peer-reviewed but HTML scraping
  'infermedica': 0.7,    // Engine - second opinion
  'visualdx': 0.8,       // Image - second opinion
};

// Maximum total context characters
const MAX_TOTAL_CONTEXT_CHARS = 12000;

/**
 * Combine evidence from all enabled providers
 */
export async function combineEvidence(query: ClinicalQuery): Promise<CombinedEvidence> {
  const providers = getEnabledProviders();
  const results: EvidenceResult[] = [];
  const sourcesQueried: string[] = [];
  const sourcesSucceeded: string[] = [];
  const sourcesFailed: string[] = [];
  const icd11Codes: Set<string> = new Set();
  
  let hasStructural = false;
  let hasLiterature = false;
  let hasEngine = false;
  let hasImage = false;

  // Query all enabled providers in parallel
  const promises = Array.from(providers).map(async (provider) => {
    sourcesQueried.push(provider.id);
    
    try {
      const providerResults = await provider.query(query);
      
      if (providerResults.length > 0) {
        sourcesSucceeded.push(provider.id);
        
        // Track evidence types
        if (provider.tier === 'structural') hasStructural = true;
        if (provider.tier === 'literature') hasLiterature = true;
        if (provider.tier === 'engine') hasEngine = true;
        if (provider.tier === 'image') hasImage = true;
        
        // Collect ICD-11 codes
        for (const result of providerResults) {
          if (result.icd11Codes) {
            result.icd11Codes.forEach(code => icd11Codes.add(code));
          }
        }
        
        return providerResults;
      }
      
      return [];
    } catch (error: any) {
      sourcesFailed.push(provider.id);
      console.warn('[EvidenceCombiner] Provider ' + provider.id + ' failed:', error.message);
      return [];
    }
  });

  // Wait for all providers
  const allResults = await Promise.all(promises);
  
  // Flatten and collect all results
  for (const providerResults of allResults) {
    results.push(...providerResults);
  }

  // Rank results by source weight and confidence
  const rankedResults = results.sort((a, b) => {
    const weightA = SOURCE_WEIGHTS[a.sourceId] || 0.5;
    const weightB = SOURCE_WEIGHTS[b.sourceId] || 0.5;
    const confidenceA = a.confidence || 0.5;
    const confidenceB = b.confidence || 0.5;
    
    // Sort by weight first, then by confidence
    return (weightB * confidenceB) - (weightA * confidenceA);
  });

  // Limit total context size
  let totalChars = 0;
  const filteredResults: EvidenceResult[] = [];
  
  for (const result of rankedResults) {
    const contentLength = result.content.length;
    if (totalChars + contentLength <= MAX_TOTAL_CONTEXT_CHARS) {
      filteredResults.push(result);
      totalChars += contentLength;
    } else {
      // Truncate and add ellipsis
      const remaining = MAX_TOTAL_CONTEXT_CHARS - totalChars;
      if (remaining > 100) {
        const truncated = result.content.slice(0, remaining - 3) + '...';
        filteredResults.push({ ...result, content: truncated });
        totalChars = MAX_TOTAL_CONTEXT_CHARS;
      }
      break;
    }
  }

  return {
    results: filteredResults,
    sourcesQueried,
    sourcesSucceeded,
    sourcesFailed,
    icd11Codes: Array.from(icd11Codes),
    hasStructuralEvidence: hasStructural,
    hasLiteratureEvidence: hasLiterature,
    hasEngineEvidence: hasEngine,
    hasImageEvidence: hasImage,
  };
}

/**
 * Check if image-based evidence is available
 */
export function hasImageEvidence(imageSubmitted: boolean): boolean {
  const visualDxEnabled = isProviderEnabled('visualdx');
  return imageSubmitted && visualDxEnabled;
}

/**
 * Check if we have sufficient evidence for high-confidence assessment
 */
export function hasSufficientEvidence(combined: CombinedEvidence): boolean {
  // Need at least structural OR literature evidence
  return combined.hasStructuralEvidence || combined.hasLiteratureEvidence;
}

/**
 * Get evidence summary for logging
 */
export function getEvidenceSummary(combined: CombinedEvidence): string {
  const parts = [];
  
  if (combined.hasStructuralEvidence) {
    parts.push('structural');
  }
  if (combined.hasLiteratureEvidence) {
    parts.push('literature');
  }
  if (combined.hasEngineEvidence) {
    parts.push('engine');
  }
  if (combined.hasImageEvidence) {
    parts.push('image');
  }
  
  return parts.length > 0 ? parts.join('+') : 'none';
}

// Re-export everything from index
export * from './types';
export * from './registry';
