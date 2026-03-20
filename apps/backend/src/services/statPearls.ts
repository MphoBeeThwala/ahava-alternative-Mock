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
const MAX_CONTEXT_CHARS = 8000;
const REQUEST_TIMEOUT_MS = 10000;
const CACHE_TTL_SECONDS = 86400; // 24 hours

// ---------------------------------------------------------------------------
// Lightweight Redis cache (optional — works without Redis)
// ---------------------------------------------------------------------------
let _redisClient: any = null;

async function getRedis(): Promise<any | null> {
  if (_redisClient) return _redisClient;
  if (!process.env.REDIS_URL) return null;
  try {
    const { createClient } = await import('redis');
    _redisClient = createClient({ url: process.env.REDIS_URL });
    await _redisClient.connect();
    return _redisClient;
  } catch {
    return null;
  }
}

async function cacheGet(key: string): Promise<string | null> {
  try {
    const r = await getRedis();
    return r ? await r.get(key) : null;
  } catch { return null; }
}

async function cacheSet(key: string, value: string): Promise<void> {
  try {
    const r = await getRedis();
    if (r) await r.setEx(key, CACHE_TTL_SECONDS, value);
  } catch { /* non-critical */ }
}

// ---------------------------------------------------------------------------
// SA-specific fallback context (high-frequency SA conditions)
// Used when NCBI is unreachable and no cache exists.
// ---------------------------------------------------------------------------
const SA_FALLBACK_CONTEXT: Record<string, string> = {
  "chest": `## Chest Pain — SA Clinical Context (SATS-aligned)
In South Africa, ACS risk is elevated due to hypertension prevalence (46% of adults aged 15+). Rheumatic heart disease remains common in patients under 40 — unlike high-income countries. Always rule out TB pericarditis in HIV-positive patients presenting with chest pain and fever. Cocaine-induced coronary spasm is emerging in urban areas.\n\nSATS Level 2 indicators: Chest pain with diaphoresis, radiation to jaw/arm, or associated dyspnoea. Refer immediately to level 3 or higher facility.`,
  "breath": `## Respiratory / Dyspnoea — SA Clinical Context
South Africa has the world's highest TB incidence (322/100,000). Any productive cough >2 weeks must be screened for TB using GeneXpert. HIV co-infection (prevalence 13.7%) elevates PCP (Pneumocystis pneumonia) risk in patients with CD4 <200. Post-COVID pulmonary fibrosis is increasingly seen. Asthma and COPD are prevalent in peri-urban areas due to biomass fuel exposure.`,
  "cough": `## Cough — SA Clinical Context
Differential includes TB (most important to exclude), URTI, bronchitis, asthma, GORD, and early pneumonia. Screen for: duration >2 weeks (TB), haemoptysis (TB/cancer), night sweats and weight loss (TB/HIV), immunocompromise. GeneXpert MTB/RIF is the preferred first-line TB test in SA.`,
  "fever": `## Fever — SA Clinical Context
In SA febrile patients: malaria must be excluded in Limpopo, Mpumalanga, KZN lowveld (rapid malaria test). Tick-bite fever (Rickettsia conorii) is endemic — look for eschar + rash. Typhoid fever occurs in areas with poor sanitation. Viral haemorrhagic fever (Crimean-Congo) in Limpopo game farming areas. HIV viral illness is a common cause of fever of unknown origin.`,
  "headache": `## Headache — SA Clinical Context
In immunocompromised patients (HIV, CD4 <100): cryptococcal meningitis presents as progressive headache with or without neck stiffness — screen with CrAg serum test. TB meningitis is endemic. Bacterial meningitis (Streptococcus pneumoniae) is more common in SA than high-income countries. Tension-type and migraine are the most common in healthy patients.`,
  "abdomen": `## Abdominal Pain — SA Clinical Context
High prevalence of amoebic liver abscess in areas with poor sanitation. Typhoid (enteric fever) with relative bradycardia. HIV-related cholangiopathy and CMV colitis in immunocompromised. Helicobacter pylori prevalence >70% in SA — common cause of peptic ulcer disease. Acute appendicitis presentation is similar to high-income countries.`,
  "dizz": `## Dizziness / Syncope — SA Clinical Context
Hypertensive emergency is a leading cause of presentation (BP crisis). Postural hypotension common in patients on antihypertensives or diuretics. Anaemia (iron deficiency, B12, folate) is prevalent — especially in women and children. Hypoglycaemia in diabetic patients on oral agents.`,
  "pain": `## Pain — SA Clinical Context
Chest pain: high ACS risk given hypertension prevalence. MSK pain: high burden of manual labour injuries. Neuropathic pain: HIV-associated peripheral neuropathy is common. Sickle cell disease in West African diaspora — vaso-occlusive crisis.`,
};

function getSAFallbackContext(query: string): string | null {
  const q = query.toLowerCase();
  for (const [key, context] of Object.entries(SA_FALLBACK_CONTEXT)) {
    if (q.includes(key)) return context;
  }
  return null;
}

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
 *
 * Resilience tier order:
 *  1. Redis cache (24h TTL) — instant, no external calls
 *  2. STATPEARLS_SERVICE_URL proxy — if configured
 *  3. Direct NCBI scrape — primary live source
 *  4. SA hardcoded fallback — always available, SA-specific
 *
 * Returns null only if all tiers fail; triage proceeds without context.
 */
export async function getMedicalContext(symptoms: string): Promise<string | null> {
  const query = extractSearchQuery(symptoms);
  if (!query) return null;

  const cacheKey = `statpearls:${query.slice(0, 60).replace(/\s+/g, '_')}`;

  // Tier 1: Redis cache
  const cached = await cacheGet(cacheKey);
  if (cached) {
    console.log(`[statPearls] Cache hit for: ${query}`);
    return cached;
  }

  // Tier 2: External StatPearls proxy service
  const serviceUrl = process.env.STATPEARLS_SERVICE_URL;
  if (serviceUrl) {
    const content = await fetchFromStatPearlsService(serviceUrl, query);
    if (content) {
      const result = content.slice(0, MAX_CONTEXT_CHARS);
      await cacheSet(cacheKey, result);
      return result;
    }
  }

  // Tier 3: Direct NCBI scrape
  try {
    const content = await fetchFromNcbi(symptoms);
    if (content) {
      await cacheSet(cacheKey, content);
      return content;
    }
  } catch (err) {
    console.warn("[statPearls] NCBI scrape failed:", (err as Error).message);
  }

  // Tier 4: SA-specific hardcoded fallback
  const saContext = getSAFallbackContext(query);
  if (saContext) {
    console.log(`[statPearls] Using SA fallback context for: ${query}`);
    return saContext;
  }

  return null;
}
