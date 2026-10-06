/**
 * Calling the AI providers (Anthropic Claude, Google Gemini) for triage.
 *
 * What this replaces, and why it matters: the old code hard-coded one model
 * name per provider, gave each call 12 seconds, read `content[0].text`, and
 * cut the patient's text to 1,600 characters. Any one of those could, and
 * did, silently push a complex case to the non-AI fallback:
 *
 *  - a retired or renamed model returned 404 on every call;
 *  - a long case with adaptive thinking takes longer than 12 s;
 *  - current models can return a `thinking` block first, so `content[0]` had
 *    no `.text`, `JSON.parse("")` threw, and the provider counted as failed;
 *  - `max_tokens` of 1,024 can be spent on thinking before any JSON is written.
 *
 * Now each provider has an ordered chain of models (configurable, with
 * known-good defaults at the end). A model that 404s, times out, refuses,
 * is truncated or returns unusable output moves the call to the next model,
 * then to the other provider. Every failure is recorded in services/
 * aiHealth.ts with its kind, so nothing fails silently, and a periodic
 * probe asks each provider which models it actually offers so a retired
 * name is routed around before a patient hits it.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  AiProvider,
  FailureKind,
  ProviderFailure,
  getAvailableModels,
  getWorkingModel,
  recordFailure,
  recordProbe,
  recordSuccess,
} from './aiHealth';

// ---- configuration ---------------------------------------------------------

const list = (raw: string | undefined, fallback: string[]): string[] => {
  const configured = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // Configured names first, then the built-in known-good tail, so a stale or
  // mistyped environment variable can never leave the chain empty or dead.
  return [...new Set([...configured, ...fallback])];
};

// Newest and most capable first. Opus for clinical reasoning quality; the
// Sonnets are cheaper and faster fallbacks if Opus is unavailable or busy.
export const DEFAULT_CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5'];
export const DEFAULT_GEMINI_MODELS = ['gemini-3.6-flash'];

export const configuredModels = (provider: AiProvider): string[] =>
  provider === 'claude'
    ? list(process.env.AI_CLAUDE_MODELS, DEFAULT_CLAUDE_MODELS)
    : list(process.env.AI_GEMINI_MODELS, DEFAULT_GEMINI_MODELS);

const intEnv = (name: string, fallback: number, min: number) =>
  Math.max(min, parseInt(process.env[name] ?? '', 10) || fallback);

// A long case with thinking can legitimately run a minute or more. Triage
// runs in a background job, so a patient is not waiting on this.
const timeoutMs = () => intEnv('AI_PROVIDER_TIMEOUT_MS', 90_000, 2_000);
const totalBudgetMs = () => intEnv('AI_PROVIDER_TOTAL_BUDGET_MS', 240_000, 5_000);
const retryDelayMs = () =>
  process.env.AI_PROVIDER_RETRY_DELAY_MS !== undefined
    ? Math.max(0, parseInt(process.env.AI_PROVIDER_RETRY_DELAY_MS, 10) || 0)
    : 1_500;
const claudeMaxTokens = () => intEnv('AI_CLAUDE_MAX_TOKENS', 8_192, 1_024);
const claudeEffort = () => process.env.AI_CLAUDE_EFFORT || 'high';

// ---- shapes ----------------------------------------------------------------

export interface AiInputFile {
  fileName: string;
  mimeType: string;
  /** Raw base64, no data: prefix. */
  base64: string;
}

export interface ProviderInput {
  prompt: string;
  files: AiInputFile[];
}

export class AiProviderError extends Error {
  constructor(public provider: AiProvider, public failures: ProviderFailure[]) {
    super(
      `${provider} failed: ` +
        (failures.map((f) => `${f.model}=${f.kind}${f.status ? `(${f.status})` : ''}`).join(', ') || 'no models tried'),
    );
    this.name = 'AiProviderError';
  }
}

class CallError extends Error {
  constructor(public kind: FailureKind, message: string, public status?: number) {
    super(message);
  }
}

const RETRYABLE: ReadonlySet<FailureKind> = new Set([
  'rate_limited', 'overloaded', 'server_error', 'timeout', 'network',
]);

export function classifyHttpFailure(status: number, body: string): FailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model_not_found';
  if (status === 400) return /model/i.test(body) ? 'model_not_found' : 'bad_request';
  if (status === 429) return 'rate_limited';
  if (status === 529 || status === 503) return 'overloaded';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pull a JSON object out of model text, tolerating fences and surrounding prose. */
export function extractJsonObject(text: string): unknown {
  const stripped = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) throw new CallError('bad_output', 'Model returned no JSON object');
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    throw new CallError('bad_output', 'Model returned malformed JSON');
  }
}

// ---- model chain -----------------------------------------------------------

/**
 * The order models are tried in: the one that last worked, then configured
 * models the provider says it offers, then a newer model discovered from its
 * live model list, then everything else configured as a last resort.
 */
export function effectiveChain(provider: AiProvider): string[] {
  const configured = configuredModels(provider);
  const available = getAvailableModels(provider);
  const working = getWorkingModel(provider);
  const present = available ? configured.filter((m) => available.includes(m)) : configured;
  const discovered = available ? discoverBestModel(provider, available) : null;
  const ordered = [
    ...(working && (!available || available.includes(working)) ? [working] : []),
    ...present,
    ...(discovered ? [discovered] : []),
    ...configured,
  ];
  return [...new Set(ordered)];
}

export function discoverBestModel(provider: AiProvider, available: string[]): string | null {
  if (provider === 'claude') {
    // The API lists newest first. Prefer Opus, then Sonnet; never the
    // restricted-access families.
    const ok = available.filter((m) => /^claude-(opus|sonnet)-/.test(m) && !/(fable|mythos|haiku)/.test(m));
    return ok.find((m) => m.startsWith('claude-opus-')) ?? ok.find((m) => m.startsWith('claude-sonnet-')) ?? null;
  }
  const flash = available
    .filter((m) => /^gemini-\d+(\.\d+)?-flash(-preview)?$/.test(m))
    .map((m) => ({ m, v: parseFloat(/gemini-(\d+(?:\.\d+)?)/.exec(m)![1]) }))
    .sort((a, b) => b.v - a.v);
  return flash[0]?.m ?? null;
}

// ---- Claude ----------------------------------------------------------------

type ClaudeBlock = { type: string; text?: string };

async function callClaudeOnce(model: string, input: ProviderInput): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new CallError('not_configured', 'ANTHROPIC_API_KEY is not configured');

  const content: Record<string, unknown>[] = [{ type: 'text', text: input.prompt }];
  for (const f of input.files) {
    if (f.mimeType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: f.mimeType, data: f.base64 } });
    } else if (/^image\/(jpeg|png|webp|gif)$/.test(f.mimeType)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: f.mimeType, data: f.base64 } });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: claudeMaxTokens(),
        output_config: { effort: claudeEffort() },
        messages: [{ role: 'user', content }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = (err as { name?: string })?.name === 'AbortError';
    throw new CallError(aborted ? 'timeout' : 'network', aborted ? `timed out after ${timeoutMs()}ms` : String((err as Error)?.message ?? err));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new CallError(classifyHttpFailure(response.status, body), body.slice(0, 300) || `HTTP ${response.status}`, response.status);
  }

  let data: { content?: ClaudeBlock[]; stop_reason?: string };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new CallError('bad_output', 'Provider returned a non-JSON response');
  }
  if (data.stop_reason === 'refusal') throw new CallError('refusal', 'The model declined this request');
  if (data.stop_reason === 'max_tokens') throw new CallError('truncated', 'Output was cut off at max_tokens');

  // Thinking blocks can come first: read the text blocks, not content[0].
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  if (!text) throw new CallError('bad_output', 'Model returned no text content');
  return text;
}

// ---- Gemini ----------------------------------------------------------------

async function callGeminiOnce(model: string, input: ProviderInput): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new CallError('not_configured', 'GEMINI_API_KEY is not configured');

  const parts: Array<string | { inlineData: { data: string; mimeType: string } }> = [input.prompt];
  for (const f of input.files) {
    if (f.mimeType === 'application/pdf' || /^image\/(jpeg|png|webp|heic)$/.test(f.mimeType)) {
      parts.push({ inlineData: { data: f.base64, mimeType: f.mimeType } });
    }
  }

  const gen = new GoogleGenerativeAI(key).getGenerativeModel({
    model,
    generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json' },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      gen.generateContent(parts),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CallError('timeout', `timed out after ${timeoutMs()}ms`)), timeoutMs());
      }),
    ]);
    const text = result.response.text().trim();
    if (!text) throw new CallError('bad_output', 'Model returned no text content');
    return text;
  } catch (err) {
    if (err instanceof CallError) throw err;
    const status = (err as { status?: number })?.status;
    const message = String((err as Error)?.message ?? err);
    if (typeof status === 'number') throw new CallError(classifyHttpFailure(status, message), message.slice(0, 300), status);
    if (/block|safety|prohibited/i.test(message)) throw new CallError('refusal', message.slice(0, 300));
    throw new CallError('network', message.slice(0, 300));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- the chain runner ------------------------------------------------------

async function runChain<T>(
  provider: AiProvider,
  input: ProviderInput,
  accept: (text: string, model: string) => T,
): Promise<{ value: T; failures: ProviderFailure[] }> {
  const once = provider === 'claude' ? callClaudeOnce : callGeminiOnce;
  const failures: ProviderFailure[] = [];
  const startedAt = Date.now();

  for (const model of effectiveChain(provider)) {
    if (Date.now() - startedAt > totalBudgetMs()) break;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await once(model, input);
        const accepted = accept(text, model);
        recordSuccess(provider, model);
        // Models skipped on the way here are still reported, so "Opus 404'd
        // and Sonnet answered" is visible, not hidden by the success.
        return { value: accepted, failures };
      } catch (err) {
        const e =
          err instanceof CallError
            ? err
            : new CallError('bad_output', String((err as Error)?.message ?? err));
        const failure: ProviderFailure = { provider, model, kind: e.kind, status: e.status, message: e.message };
        // One retry for transient trouble on the same model; everything else
        // moves straight to the next model.
        if (attempt === 0 && RETRYABLE.has(e.kind)) {
          await sleep(retryDelayMs());
          continue;
        }
        failures.push(failure);
        recordFailure(failure);
        // A bad key or missing configuration won't be fixed by another model.
        if (e.kind === 'auth' || e.kind === 'not_configured') throw new AiProviderError(provider, failures);
        break;
      }
    }
  }
  throw new AiProviderError(provider, failures);
}

export const runClaude = <T>(input: ProviderInput, accept: (text: string, model: string) => T) =>
  runChain('claude', input, accept);
export const runGemini = <T>(input: ProviderInput, accept: (text: string, model: string) => T) =>
  runChain('gemini', input, accept);

// ---- probing ---------------------------------------------------------------

/**
 * Ask each configured provider which models it offers. Cheap (a list call,
 * no tokens spent). A failure here is an early warning (dead key, retired
 * model, provider outage) found before a patient's case hits it.
 */
export async function probeAiProviders(): Promise<void> {
  await Promise.all([probeClaude(), probeGemini()]);
}

async function probeClaude(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return;
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (body.data ?? []).map((m) => m.id);
    recordProbe('claude', { ok: true, models });
    const chain = configuredModels('claude');
    if (!chain.some((m) => models.includes(m))) {
      console.error(`[aiHealth] none of the configured Claude models (${chain.join(', ')}) are offered; will use ${discoverBestModel('claude', models) ?? 'nothing'}`);
    }
  } catch (err) {
    recordProbe('claude', { ok: false, error: String((err as Error)?.message ?? err) });
  }
}

async function probeGemini(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return;
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const body = (await res.json()) as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
    };
    const models = (body.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
    recordProbe('gemini', { ok: true, models });
  } catch (err) {
    recordProbe('gemini', { ok: false, error: String((err as Error)?.message ?? err) });
  }
}

let monitor: ReturnType<typeof setInterval> | null = null;

/** Probe now, then every AI_HEALTH_PROBE_INTERVAL_MS (default 10 minutes). */
export function startAiHealthMonitor(): void {
  if (monitor || process.env.NODE_ENV === 'test') return;
  void probeAiProviders();
  monitor = setInterval(
    () => void probeAiProviders(),
    intEnv('AI_HEALTH_PROBE_INTERVAL_MS', 10 * 60_000, 30_000),
  );
  monitor.unref();
}
