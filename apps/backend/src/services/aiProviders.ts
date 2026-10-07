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

// A long case with thinking can legitimately run a couple of minutes. Triage
// runs in a background job, so a patient is not waiting on this. Claude is
// streamed, so what catches a hung connection is the IDLE timeout (no bytes at
// all for this long); the per-call ceiling only bounds a model that keeps
// talking. A non-streamed call had one hard cap and gave up on answers that
// were seconds from finishing.
const timeoutMs = () => intEnv('AI_PROVIDER_TIMEOUT_MS', 150_000, 2_000);
const idleTimeoutMs = () => intEnv('AI_PROVIDER_IDLE_TIMEOUT_MS', 40_000, 2_000);
// Each provider has its own budget, so a slow Claude chain can never eat the
// time Gemini needs: Claude had been allowed to run for 6+ minutes before
// Gemini was even tried.
const chainBudgetMs = (provider: AiProvider) =>
  process.env.AI_PROVIDER_TOTAL_BUDGET_MS
    ? intEnv('AI_PROVIDER_TOTAL_BUDGET_MS', 240_000, 5_000)
    : provider === 'claude'
      ? intEnv('AI_CLAUDE_BUDGET_MS', 200_000, 5_000)
      : intEnv('AI_GEMINI_BUDGET_MS', 120_000, 5_000);
const retryDelayMs = () =>
  process.env.AI_PROVIDER_RETRY_DELAY_MS !== undefined
    ? Math.max(0, parseInt(process.env.AI_PROVIDER_RETRY_DELAY_MS, 10) || 0)
    : 1_500;
const claudeMaxTokens = () => intEnv('AI_CLAUDE_MAX_TOKENS', 8_192, 1_024);
const claudeEffort = () => process.env.AI_CLAUDE_EFFORT || 'high';
// After a model has timed out or been overloaded, the next one is asked to
// think less: a faster answer from Sonnet beats a second timeout from the
// same slow path.
const fallbackEffort = () => process.env.AI_CLAUDE_FALLBACK_EFFORT || 'medium';

interface CallOptions {
  /** Longest this one call may take, already capped to the chain's remaining budget. */
  limitMs: number;
  effort: string;
}

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

const claudeErrorKind = (type: string | undefined): FailureKind => {
  switch (type) {
    case 'overloaded_error': return 'overloaded';
    case 'rate_limit_error': return 'rate_limited';
    case 'authentication_error':
    case 'permission_error': return 'auth';
    case 'not_found_error': return 'model_not_found';
    case 'invalid_request_error': return 'bad_request';
    case 'api_error': return 'server_error';
    default: return 'unknown';
  }
};

/** What a finished Claude message must satisfy, streamed or not. */
function textOfMessage(blocks: ClaudeBlock[], stopReason: string | undefined): string {
  if (stopReason === 'refusal') throw new CallError('refusal', 'The model declined this request');
  if (stopReason === 'max_tokens') throw new CallError('truncated', 'Output was cut off at max_tokens');
  // Thinking blocks can come first: read the text blocks, not content[0].
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  if (!text) throw new CallError('bad_output', 'Model returned no text content');
  return text;
}

/**
 * Read a streamed Claude message. Every chunk (including the keep-alive
 * pings) resets `onActivity`, so only a connection that goes silent is cut.
 */
async function readClaudeStream(response: Response, onActivity: () => void): Promise<string> {
  if (!response.body) throw new CallError('bad_output', 'Provider returned an empty stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const blocks = new Map<number, ClaudeBlock>();
  let stopReason: string | undefined;
  let buffer = '';

  const handle = (raw: string) => {
    const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (!data) return;
    let event: {
      type?: string; index?: number;
      content_block?: ClaudeBlock; delta?: { type?: string; text?: string; stop_reason?: string };
      error?: { type?: string; message?: string };
    };
    try { event = JSON.parse(data); } catch { return; }
    switch (event.type) {
      case 'content_block_start':
        blocks.set(event.index ?? 0, { type: event.content_block?.type ?? 'text', text: event.content_block?.text ?? '' });
        break;
      case 'content_block_delta': {
        const block = blocks.get(event.index ?? 0);
        if (block && block.type === 'text' && event.delta?.type === 'text_delta') block.text = (block.text ?? '') + (event.delta.text ?? '');
        break;
      }
      case 'message_delta':
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        break;
      case 'error':
        // The provider can fail AFTER sending a 200: treat it like any other failure.
        throw new CallError(claudeErrorKind(event.error?.type), (event.error?.message ?? 'stream error').slice(0, 300));
      default:
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      handle(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) handle(buffer);
  return textOfMessage([...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b), stopReason);
}

async function callClaudeOnce(model: string, input: ProviderInput, opts: CallOptions): Promise<string> {
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
  let abortedFor: 'ceiling' | 'idle' | null = null;
  const abort = (why: 'ceiling' | 'idle') => { abortedFor = why; controller.abort(); };
  const ceiling = setTimeout(() => abort('ceiling'), opts.limitMs);
  let idle = setTimeout(() => abort('idle'), idleTimeoutMs());
  const onActivity = () => { clearTimeout(idle); idle = setTimeout(() => abort('idle'), idleTimeoutMs()); };
  const timedOut = () =>
    new CallError('timeout', abortedFor === 'idle' ? `no data from the provider for ${idleTimeoutMs()}ms` : `timed out after ${opts.limitMs}ms`);

  try {
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model,
          max_tokens: claudeMaxTokens(),
          stream: true,
          output_config: { effort: opts.effort },
          messages: [{ role: 'user', content }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw timedOut();
      throw new CallError('network', String((err as Error)?.message ?? err));
    }
    onActivity();

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new CallError(classifyHttpFailure(response.status, body), body.slice(0, 300) || `HTTP ${response.status}`, response.status);
    }

    try {
      if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
        return await readClaudeStream(response, onActivity);
      }
      // A non-streamed JSON body (older proxies, tests) is read the same way as before.
      let data: { content?: ClaudeBlock[]; stop_reason?: string };
      try {
        data = (await response.json()) as typeof data;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') throw timedOut();
        throw new CallError('bad_output', 'Provider returned a non-JSON response');
      }
      return textOfMessage(data.content ?? [], data.stop_reason);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw timedOut();
      throw err;
    }
  } finally {
    clearTimeout(ceiling);
    clearTimeout(idle);
  }
}

// ---- Gemini ----------------------------------------------------------------

async function callGeminiOnce(model: string, input: ProviderInput, opts: CallOptions): Promise<string> {
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
        timer = setTimeout(() => reject(new CallError('timeout', `timed out after ${opts.limitMs}ms`)), opts.limitMs);
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

// Not worth starting a call that has less than this left of the chain's budget.
const MIN_CALL_MS = 5_000;

async function runChain<T>(
  provider: AiProvider,
  input: ProviderInput,
  accept: (text: string, model: string) => T,
): Promise<{ value: T; failures: ProviderFailure[] }> {
  const once = provider === 'claude' ? callClaudeOnce : callGeminiOnce;
  const failures: ProviderFailure[] = [];
  const startedAt = Date.now();
  const remaining = () => chainBudgetMs(provider) - (Date.now() - startedAt);
  // Once a model has been slow or busy, ask the next one to think less.
  let slowPath = false;

  for (const model of effectiveChain(provider)) {
    if (remaining() < MIN_CALL_MS) break;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (remaining() < MIN_CALL_MS) break;
      try {
        const text = await once(model, input, {
          limitMs: Math.min(timeoutMs(), remaining()),
          effort: slowPath ? fallbackEffort() : claudeEffort(),
        });
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
        if (e.kind === 'timeout' || e.kind === 'overloaded') slowPath = true;
        // One retry for brief trouble (a busy or erroring provider) on the same
        // model. A TIMEOUT is not retried on the same model: the same slow
        // path would burn the whole budget twice before the next model got a go.
        if (attempt === 0 && RETRYABLE.has(e.kind) && e.kind !== 'timeout') {
          await sleep(Math.min(retryDelayMs(), Math.max(0, remaining() - MIN_CALL_MS)));
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
  if (failures.length === 0 && remaining() < MIN_CALL_MS) {
    failures.push({ provider, model: 'n/a', kind: 'timeout', message: 'the provider time budget was used up before any model answered' });
  }
  throw new AiProviderError(provider, failures);
}

export const runClaude = <T>(input: ProviderInput, accept: (text: string, model: string) => T) =>
  runChain('claude', input, accept);
export const runGemini = <T>(input: ProviderInput, accept: (text: string, model: string) => T) =>
  runChain('gemini', input, accept);

// ---- single-model check ----------------------------------------------------

export interface ModelCheck {
  provider: AiProvider;
  model: string;
  ok: boolean;
  /** Time until the call finished, whether it worked or not. */
  ms: number;
  kind?: FailureKind;
  status?: number;
  message?: string;
}

/**
 * One tiny real call to one model, with the same code, timeouts and effort the
 * triage path uses, and no retry or fallback. Answers "is THIS model working
 * from THIS server, and how long does it take?" (npm run ai-pack -- --smoke).
 */
export async function checkModel(provider: AiProvider, model: string, limitMs = 60_000): Promise<ModelCheck> {
  const started = Date.now();
  const once = provider === 'claude' ? callClaudeOnce : callGeminiOnce;
  try {
    const text = await once(model, { prompt: 'Reply with exactly this JSON and nothing else: {"ok": true}', files: [] }, { limitMs, effort: claudeEffort() });
    extractJsonObject(text);
    return { provider, model, ok: true, ms: Date.now() - started };
  } catch (err) {
    const e = err instanceof CallError ? err : new CallError('unknown', String((err as Error)?.message ?? err));
    return { provider, model, ok: false, ms: Date.now() - started, kind: e.kind, status: e.status, message: e.message.slice(0, 200) };
  }
}

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
