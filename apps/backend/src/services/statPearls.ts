/**
 * StatPearls medical knowledge service - Option A (Proxy/Context Injection)
 *
 * Fetches peer-reviewed medical context from NCBI StatPearls (same source as
 * StatPearls MCP) and injects it into triage prompts. No MCP/Bun required.
 *
 * Optional: Set STATPEARLS_SERVICE_URL to call a deployed StatPearls HTTP wrapper
 * (e.g. StatPearls MCP behind an HTTP proxy) instead of direct NCBI fetch.
 */

import * as cheerio from "cheerio";

// eutils search endpoint — requires NCBI_API_KEY in env for production rate limits
const NCBI_ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const MAX_CONTEXT_CHARS = 8000; // Keep prompt size reasonable
const REQUEST_TIMEOUT_MS = 10000;

interface SearchResult {
  title: string;
  url: string;
  description?: string;
}

interface ExtractedSection {
  heading: string;
  content: string;
}

/**
 * Extract symptom keywords for StatPearls search.
 * Uses first 3-5 significant words; avoids common filler.
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
  // Take first 5 words or up to 50 chars
  const query = words.slice(0, 5).join(" ");
  return query.length > 0 ? query : symptoms.slice(0, 80);
}

/**
 * Fetch medical context from external StatPearls HTTP service.
 * Use when STATPEARLS_SERVICE_URL is set (e.g. StatPearls MCP behind HTTP proxy).
 */
async function fetchFromStatPearlsService(
  baseUrl: string,
  query: string
): Promise<string | null> {
  const url = baseUrl.replace(/\/$/, "") + "/disease-info";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string; text?: string };
    const content = data.content ?? data.text ?? "";
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

/**
 * Search NCBI StatPearls and return top results.
 * Uses eutils esearch API with optional API key.
 */
async function searchNcbiStatPearls(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : '';
  const searchUrl = `${NCBI_ESEARCH_URL}?db=books&term=${encodeURIComponent(query)}+AND+NBK430685[book]&retmode=json${apiKey}`;
  const res = await fetch(searchUrl, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $(".rslt").each((_, el) => {
    const $el = $(el);
    const $link = $el.find("a").first();
    const title = $link.text().trim();
    const href = $link.attr("href");
    if (!title || !href) return;
    const url = href.startsWith("http")
      ? href
      : new URL(href, "https://www.ncbi.nlm.nih.gov").toString();
    const desc = $el.find("p").first().text().trim();
    results.push({ title, url, description: desc || undefined });
  });
  return results;
}

/**
 * Fetch article HTML and extract key medical sections.
 */
async function fetchAndExtractArticle(url: string): Promise<string | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);
  const sections: ExtractedSection[] = [];

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
    if (process.env.NODE_ENV === 'production') {
      console.warn('[statPearls] Article extraction returned no sections — NCBI HTML selectors may be stale.');
    }
    return null;
  }
  const markdown = sections
    .map((s) => `## ${s.heading}\n${s.content}`)
    .join("\n\n");
  return markdown.slice(0, MAX_CONTEXT_CHARS);
}

/**
 * Internal helper: fetch from service URL or NCBI directly.
 */
async function fetchContent(symptoms: string, query: string, serviceUrl?: string): Promise<string | null> {
  if (serviceUrl) {
    const content = await fetchFromStatPearlsService(serviceUrl, query);
    if (content) return content.slice(0, MAX_CONTEXT_CHARS);
  }
  try {
    const result = await fetchFromNcbi(symptoms);
    if (!result && process.env.NODE_ENV === 'production' && !serviceUrl) {
      console.warn('[statPearls] NCBI fetch returned null — selectors may be stale or rate-limited. Set NCBI_API_KEY.');
    }
    return result;
  } catch (err) {
    console.warn('[statPearls] Failed to fetch medical context:', err);
    return null;
  }
}

/**
 * Fetch medical context for triage from NCBI StatPearls.
 */
async function fetchFromNcbi(symptoms: string): Promise<string | null> {
  const query = extractSearchQuery(symptoms);
  const results = await searchNcbiStatPearls(query);
  if (results.length === 0) return null;
  const top = results[0];
  const content = await fetchAndExtractArticle(top.url);
  if (!content) return null;
  return `### Reference: ${top.title}\n\n${content}`;
}

/**
 * Get peer-reviewed medical context for the given symptoms.
 * Uses Redis cache (24h TTL) to avoid hammering NCBI on every triage call.
 * Falls back to STATPEARLS_SERVICE_URL or direct NCBI fetch.
 * Returns null on failure; triage proceeds without context.
 */
export async function getMedicalContext(symptoms: string): Promise<string | null> {
  const serviceUrl = process.env.STATPEARLS_SERVICE_URL;
  const query = extractSearchQuery(symptoms);
  if (!query) return null;

  const cacheKey = `statpearls:${query.slice(0, 80).replace(/\s+/g, '_')}`;

  try {
    const { getRedis } = await import('./redis');
    const redis = getRedis();
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log('[statPearls] Cache hit for:', query);
        return cached;
      }
      const content = await fetchContent(symptoms, query, serviceUrl);
      if (content) {
        await redis.setex(cacheKey, 86400, content); // 24-hour TTL
      }
      return content;
    }
  } catch {
    console.warn('[statPearls] Redis cache unavailable, fetching directly');
  }

  return fetchContent(symptoms, query, serviceUrl);
}
