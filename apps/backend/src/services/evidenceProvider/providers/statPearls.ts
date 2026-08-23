/**
 * StatPearls Provider (Refactored)
 * Tier: literature
 * Purpose: Fetch peer-reviewed medical context from NCBI StatPearls
 * Now implements the EvidenceProvider interface for consistency
 */

import { EvidenceProvider, EvidenceProviderConfig, ClinicalQuery, EvidenceResult } from '../types';
import * as cheerio from "cheerio";

const NCBI_ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const MAX_CONTEXT_CHARS = 8000;
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Extract symptom keywords for StatPearls search
 */
function extractSearchQuery(symptoms: string): string {
  const stop = new Set([
    "i", "me", "my", "have", "has", "had", "am", "been", "feel", "feeling",
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "since", "about", "when", "that", "this", "it", "is",
  ]);
  const words = symptoms
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  const query = words.slice(0, 5).join(" ");
  return query.length > 0 ? query : symptoms.slice(0, 80);
}

/**
 * StatPearls Provider
 */
export function statPearlsProvider(config: EvidenceProviderConfig): EvidenceProvider {
  const baseUrl = config.baseUrl || 'https://www.ncbi.nlm.nih.gov';
  const apiKey = config.apiKey || process.env.NCBI_API_KEY || '';
  const timeoutMs = config.timeoutMs || REQUEST_TIMEOUT_MS;

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
        const searchQuery = extractSearchQuery(symptoms);
        const results = await searchNcbiStatPearls(searchQuery, apiKey, timeoutMs);
        
        if (results.length === 0) {
          return [];
        }

        const top = results[0];
        const content = await fetchAndExtractArticle(top.url, timeoutMs);
        
        if (!content) {
          return [];
        }

        return [{
          sourceId: 'statpearls',
          content: '### Reference: ' + top.title + '\n\n' + content,
          citation: 'StatPearls/NCBI - ' + top.title + ' (URL: ' + top.url + ')',
          confidence: 0.85,
          retrievedAt: new Date().toISOString(),
        }];
      } catch (error: any) {
        console.warn('[StatPearls] Query failed:', error.message);
        return [];
      }
    },

    async healthCheck(): Promise<boolean> {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const url = NCBI_ESEARCH_URL + '?db=books&term=test+AND+NBK430685[book]&retmode=json';
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
 * Search NCBI StatPearls and return top results
 */
async function searchNcbiStatPearls(query: string, apiKey: string, timeoutMs: number): Promise<{title: string, url: string}[]> {
  const searchUrl = NCBI_ESEARCH_URL + '?db=books&term=' + encodeURIComponent(query) + 
    '+AND+NBK430685[book]&retmode=json' + (apiKey ? '&api_key=' + apiKey : '');
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  const res = await fetch(searchUrl, {
    signal: controller.signal,
  });
  
  clearTimeout(timeout);
  
  if (!res.ok) {
    return [];
  }
  
  const html = await res.text();
  const $ = cheerio.load(html);
  const results: {title: string, url: string}[] = [];
  
  $(".rslt").each((_, el) => {
    const $el = $(el);
    const $link = $el.find("a").first();
    const title = $link.text().trim();
    const href = $link.attr("href");
    if (!title || !href) return;
    const url = href.startsWith("http")
      ? href
      : new URL(href, baseUrl).toString();
    const desc = $el.find("p").first().text().trim();
    results.push({ title, url });
  });
  
  return results;
}

/**
 * Fetch article HTML and extract key medical sections
 */
async function fetchAndExtractArticle(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  const res = await fetch(url, {
    signal: controller.signal,
  });
  
  clearTimeout(timeout);
  
  if (!res.ok) {
    return null;
  }
  
  const html = await res.text();
  const $ = cheerio.load(html);
  const sections: { heading: string; content: string }[] = [];

  // NCBI StatPearls article structure
  $(".jig-ncbiinpagenav div[id^='article-']").each((_, el) => {
    const heading = $(el).find("> h2").first().text().trim();
    if (!heading) return;
    const skip = ["References", "Author Information", "Copyright", "Disclosure", "Article Information", "Review Questions"];
    if (skip.some((s) => heading.toLowerCase().includes(s.toLowerCase()))) return;
    let content = "";
    $(el)
      .children()
      .each((i, child) => {
        if (i > 0) content += $(child).text().trim() + " ";
      });
    if (content.trim()) sections.push({ heading, content: content.trim() });
  });

  if (sections.length === 0) {
    console.warn('[statPearls] Article extraction returned no sections - NCBI HTML selectors may be stale.');
    return null;
  }
  
  const markdown = sections
    .map((s) => '## ' + s.heading + '\n' + s.content)
    .join("\n\n");
  
  return markdown.slice(0, MAX_CONTEXT_CHARS);
}

/**
 * Legacy function for backward compatibility
 * This maintains the existing interface used by aiTriage.ts
 */
export async function getMedicalContext(symptoms: string): Promise<string | null> {
  const provider = statPearlsProvider({
    id: 'statpearls',
    tier: 'literature',
    enabled: true,
    baseUrl: 'https://www.ncbi.nlm.nih.gov',
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  
  const results = await provider.query({ symptoms });
  
  if (results.length === 0) {
    return null;
  }
  
  // Return the first result's content
  return results[0].content;
}
