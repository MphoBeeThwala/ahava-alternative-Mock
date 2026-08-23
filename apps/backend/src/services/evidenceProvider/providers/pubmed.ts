/**
 * PubMed/MEDLINE via NCBI E-utilities Provider
 * Tier: literature
 * Purpose: Retrieve peer-reviewed medical literature from PubMed
 * Uses NCBI E-utilities API with optional API key for higher rate limits
 */

import { EvidenceProvider, EvidenceProviderConfig, ClinicalQuery, EvidenceResult } from '../types';

interface PubMedSearchResult {
  esearchresult?: {
    idlist?: string[];
    count?: string;
  };
}

interface PubMedFetchResult {
  pubmedarticle?: {
    medlinecitation?: {
      pmid?: { '#text': string };
      articletitle?: { '#text': string };
      abstract?: { abstracttext?: { '#text': string } | { '#text': string }[] };
      journal?: { title?: string; journalissue?: { pubdate?: { year?: string; month?: string } } };
      authorlist?: { author?: { lastname?: string; foreachname?: string }[] };
    }[];
  };
}

/**
 * PubMed Provider
 * Uses NCBI E-utilities esearch and efetch APIs
 */
export function pubmedProvider(config: EvidenceProviderConfig): EvidenceProvider {
  const baseUrl = config.baseUrl || 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const apiKey = config.apiKey || process.env.NCBI_API_KEY || '';
  const timeoutMs = config.timeoutMs || 10000;
  const maxResults = 3; // Limit to 3 most relevant results

  return {
    id: config.id,
    tier: 'literature',
    config,

    async query(query: ClinicalQuery): Promise<EvidenceResult[]> {
      const symptoms = query.symptoms || '';
      
      if (!symptoms.trim()) {
        return [];
      }

      try {
        // Extract key terms for search
        const searchTerms = extractSearchTerms(symptoms);
        
        // Search PubMed
        const pmidList = await searchPubMed(searchTerms, baseUrl, apiKey, timeoutMs);
        
        if (pmidList.length === 0) {
          return [];
        }

        // Fetch article details for top results
        const results: EvidenceResult[] = [];
        for (let i = 0; i < Math.min(pmidList.length, maxResults); i++) {
          const pmid = pmidList[i];
          const article = await fetchPubMedArticle(pmid, baseUrl, apiKey, timeoutMs);
          
          if (article) {
            results.push(article);
          }
        }

        return results;
      } catch (error: any) {
        console.warn('[PubMed] Query failed:', error.message);
        return [];
      }
    },

    async healthCheck(): Promise<boolean> {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const url = baseUrl + '/esearch.fcgi?db=pubmed&term=test&retmode=json' + (apiKey ? '&api_key=' + apiKey : '');
        const response = await fetch(url, {
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
 * Extract search terms from symptoms
 */
function extractSearchTerms(symptoms: string): string {
  const stopWords = new Set(['i', 'me', 'my', 'have', 'has', 'had', 'am', 'been', 'feel', 'feeling',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'since', 'about', 'when', 'that', 'this', 'it', 'is', 'are', 'was', 'were']);

  const words = symptoms
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  return words.slice(0, 5).join(' ');
}

/**
 * Search PubMed for relevant articles
 */
async function searchPubMed(terms: string, baseUrl: string, apiKey: string, timeoutMs: number): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let url = baseUrl + '/esearch.fcgi?db=pubmed&term=' + encodeURIComponent(terms) + 
      '&retmode=json&retmax=' + maxResults + '&sort=relevance';
    
    if (apiKey) {
      url += '&api_key=' + apiKey;
    }

    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn('[PubMed] Search failed with status:', response.status);
      return [];
    }

    const data: PubMedSearchResult = await response.json();
    const idList = data.esearchresult?.idlist || [];
    
    return idList;
  } catch (error: any) {
    console.warn('[PubMed] Search error:', error.message);
    return [];
  }
}

/**
 * Fetch article details from PubMed
 */
async function fetchPubMedArticle(pmid: string, baseUrl: string, apiKey: string, timeoutMs: number): Promise<EvidenceResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let url = baseUrl + '/efetch.fcgi?db=pubmed&id=' + pmid + '&retmode=xml';
    
    if (apiKey) {
      url += '&api_key=' + apiKey;
    }

    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const xmlText = await response.text();
    
    // Parse XML to extract title and abstract
    const titleMatch = xmlText.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    const abstractMatch = xmlText.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/);
    const pmidMatch = xmlText.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const journalMatch = xmlText.match(/<Title>([\s\S]*?)<\/Title>/);
    const yearMatch = xmlText.match(/<PubDate[^>]*><Year>(\d{4})<\/Year>/);

    const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : 'Untitled';
    const abstract = abstractMatch ? abstractMatch[1].replace(/<[^>]*>/g, '').trim() : '';
    const pmidFinal = pmidMatch ? pmidMatch[1] : pmid;
    const journal = journalMatch ? journalMatch[1].replace(/<[^>]*>/g, '').trim() : 'Unknown';
    const year = yearMatch ? yearMatch[1] : 'Unknown';

    if (!abstract) {
      return null;
    }

    // Paraphrase the abstract - take first 2-3 sentences max
    const sentences = abstract.split(/[.!?]/).filter(s => s.trim().length > 0);
    const paraphrased = sentences.slice(0, 2).join('. ') + (sentences.length > 2 ? '.' : '');

    return {
      sourceId: 'pubmed',
      content: paraphrased,
      citation: journal + ' (PMID: ' + pmidFinal + ', ' + year + ')',
      confidence: 0.9,
      retrievedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.warn('[PubMed] Fetch error for PMID ' + pmid + ':', error.message);
    return null;
  }
}
