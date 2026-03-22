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

const NCBI_STATPEARLS_SEARCH = "https://www.ncbi.nlm.nih.gov/books/NBK430685/";
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
 */
async function searchNcbiStatPearls(query: string): Promise<SearchResult[]> {
  const searchUrl = `${NCBI_STATPEARLS_SEARCH}?term=${encodeURIComponent(query)}`;
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

  if (sections.length === 0) return null;
  const markdown = sections
    .map((s) => `## ${s.heading}\n${s.content}`)
    .join("\n\n");
  return markdown.slice(0, MAX_CONTEXT_CHARS);
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
 * Uses STATPEARLS_SERVICE_URL if set, otherwise fetches directly from NCBI StatPearls.
 * Returns null on failure; triage proceeds without context.
 */
export async function getMedicalContext(symptoms: string): Promise<string | null> {
  const serviceUrl = process.env.STATPEARLS_SERVICE_URL;
  const query = extractSearchQuery(symptoms);
  if (!query) return null;

  if (serviceUrl) {
    const content = await fetchFromStatPearlsService(serviceUrl, query);
    if (content) return content.slice(0, MAX_CONTEXT_CHARS);
  }

  try {
    return await fetchFromNcbi(symptoms);
  } catch (err) {
    console.warn("[statPearls] Failed to fetch medical context:", err);
    return null;
  }
}
