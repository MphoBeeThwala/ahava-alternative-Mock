/**
 * AI provider health: what failed, when, and why: kept where people can see it.
 *
 * Until this existed, a provider failure was one `console.warn` line. Triage
 * kept "working" while every case silently fell through to a non-AI
 * fallback, and nobody found out until a tester did. This module is the
 * single place that:
 *  - records every provider success and failure, with a machine-readable
 *    failure kind (auth, model not found, timeout, bad output, ...);
 *  - summarises overall status (ok / degraded / down) for /ready and the
 *    admin endpoint;
 *  - emails administrators when AI analysis goes down or recovers, with a
 *    cooldown so an outage is one email an hour, not one per patient;
 *  - remembers which models each provider actually offers (from the
 *    periodic probe in services/aiProviders.ts) so a retired model name
 *    is routed around instead of failing every case.
 *
 * Nothing here ever contains patient data: only provider, model, status and
 * a short error string.
 */

export type AiProvider = 'claude' | 'gemini';

export type FailureKind =
  | 'auth'
  | 'model_not_found'
  | 'rate_limited'
  | 'overloaded'
  | 'timeout'
  | 'network'
  | 'server_error'
  | 'bad_request'
  | 'refusal'
  | 'truncated'
  | 'bad_output'
  | 'not_configured'
  | 'unknown';

export interface ProviderFailure {
  provider: AiProvider;
  model: string;
  kind: FailureKind;
  status?: number;
  /** Short, PHI-free description (provider error text, trimmed). */
  message: string;
}

export interface ProviderState {
  provider: AiProvider;
  configured: boolean;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailure: ProviderFailure | null;
  /** The model that last produced a valid result. Tried first next time. */
  workingModel: string | null;
  /** Model ids the provider reported at the last successful probe. */
  availableModels: string[] | null;
  lastProbeAt: string | null;
  lastProbeOk: boolean | null;
  lastProbeError: string | null;
}

export type AiOverallStatus = 'ok' | 'degraded' | 'down' | 'unconfigured';

const PROVIDERS: AiProvider[] = ['claude', 'gemini'];

const state = new Map<AiProvider, ProviderState>();

function fresh(provider: AiProvider): ProviderState {
  return {
    provider,
    configured: isConfigured(provider),
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailure: null,
    workingModel: null,
    availableModels: null,
    lastProbeAt: null,
    lastProbeOk: null,
    lastProbeError: null,
  };
}

function isConfigured(provider: AiProvider): boolean {
  return provider === 'claude'
    ? !!process.env.ANTHROPIC_API_KEY
    : !!process.env.GEMINI_API_KEY;
}

export function getProviderState(provider: AiProvider): ProviderState {
  let s = state.get(provider);
  if (!s) {
    s = fresh(provider);
    state.set(provider, s);
  }
  s.configured = isConfigured(provider);
  return s;
}

const trim = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ---- per-model health -------------------------------------------------------
//
// The first live run of the diagnostic pack showed a flaw in "try the model that
// last worked first": ONE slow Opus call made Sonnet the "working model", Sonnet
// kept succeeding, and every later case was answered by Sonnet until the process
// restarted, silently, on the hardest cases. A model is now demoted only when it
// is actually unhealthy:
//  - it does not exist (model_not_found): demoted for an hour, because retrying a
//    retired name costs a round trip on every case; or
//  - it has failed several times IN A ROW (a circuit breaker): demoted for a short
//    cool-down, so an Opus outage does not make every case wait out a timeout, and
//    then tried again.
// A single timeout or overload demotes nothing.

interface ModelHealth {
  consecutive: number;
  lastFailureAt: number;
  lastKind: FailureKind | null;
}

const modelHealth = new Map<string, ModelHealth>();
const healthKey = (provider: AiProvider, model: string) => `${provider}:${model}`;

const envMs = (name: string, fallback: number) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const circuitThreshold = () => Math.max(1, envMs('AI_MODEL_CIRCUIT_THRESHOLD', 3));
const circuitOpenMs = () => envMs('AI_MODEL_CIRCUIT_OPEN_MS', 120_000);
const retiredModelDemotionMs = () => envMs('AI_MODEL_RETIRED_DEMOTION_MS', 60 * 60_000);

export function isModelDemoted(provider: AiProvider, model: string): boolean {
  const h = modelHealth.get(healthKey(provider, model));
  if (!h || h.lastKind === null) return false;
  const sinceFailure = Date.now() - h.lastFailureAt;
  if (h.lastKind === 'model_not_found') return sinceFailure < retiredModelDemotionMs();
  return h.consecutive >= circuitThreshold() && sinceFailure < circuitOpenMs();
}

export function recordSuccess(provider: AiProvider, model: string): void {
  const s = getProviderState(provider);
  s.consecutiveFailures = 0;
  s.lastSuccessAt = new Date().toISOString();
  s.workingModel = model; // informational (admin status); no longer reorders the chain
  modelHealth.delete(healthKey(provider, model));
  void evaluateAlerts();
}

export function recordFailure(failure: ProviderFailure): void {
  const s = getProviderState(failure.provider);
  const key = healthKey(failure.provider, failure.model);
  const h = modelHealth.get(key) ?? { consecutive: 0, lastFailureAt: 0, lastKind: null };
  modelHealth.set(key, { consecutive: h.consecutive + 1, lastFailureAt: Date.now(), lastKind: failure.kind });
  s.consecutiveFailures += 1;
  s.lastFailureAt = new Date().toISOString();
  s.lastFailure = { ...failure, message: trim(failure.message) };
  console.error(
    `[aiHealth] ${failure.provider} (${failure.model}) failed: ${failure.kind}` +
      `${failure.status ? ` ${failure.status}` : ''} - ${trim(failure.message)}`,
  );
  void evaluateAlerts();
}

/** Result of the periodic provider probe (a model-list call, no tokens spent). */
export function recordProbe(
  provider: AiProvider,
  result: { ok: true; models: string[] } | { ok: false; error: string },
): void {
  const s = getProviderState(provider);
  s.lastProbeAt = new Date().toISOString();
  if (result.ok) {
    s.lastProbeOk = true;
    s.lastProbeError = null;
    s.availableModels = result.models;
  } else {
    s.lastProbeOk = false;
    s.lastProbeError = trim(result.error);
  }
}

export function getAvailableModels(provider: AiProvider): string[] | null {
  return getProviderState(provider).availableModels;
}

export function getWorkingModel(provider: AiProvider): string | null {
  return getProviderState(provider).workingModel;
}

function providerIsFailing(s: ProviderState): boolean {
  // Two failures in a row, so a single blip isn't an outage. A failed probe
  // counts too: it finds a dead key or retired model before a patient does.
  return s.configured && (s.consecutiveFailures >= 2 || s.lastProbeOk === false);
}

export function getAiHealth(): {
  status: AiOverallStatus;
  providers: ProviderState[];
} {
  const providers = PROVIDERS.map(getProviderState);
  const configured = providers.filter((p) => p.configured);
  if (configured.length === 0) return { status: 'unconfigured', providers };
  const failing = configured.filter(providerIsFailing);
  const status: AiOverallStatus =
    failing.length === configured.length ? 'down' : failing.length > 0 ? 'degraded' : 'ok';
  return { status, providers };
}

// ---- alerting --------------------------------------------------------------

const alertCooldownMs = () =>
  Math.max(1, parseInt(process.env.AI_ALERT_COOLDOWN_MINUTES ?? '60', 10) || 60) * 60_000;

let lastDownAlertAt = 0;
let downAlerted = false;

async function claimAlertSlot(): Promise<boolean> {
  const now = Date.now();
  if (now - lastDownAlertAt < alertCooldownMs()) return false;
  try {
    const { getRedis } = await import('./redis');
    // One replica sends the email; the others see the lock and stay quiet.
    const got = await getRedis().set(
      'ai:health:alert-lock',
      '1',
      'EX',
      Math.ceil(alertCooldownMs() / 1000),
      'NX',
    );
    if (got === null) return false;
  } catch {
    /* Redis unavailable: this replica's own cooldown is the only guard */
  }
  lastDownAlertAt = now;
  return true;
}

async function emailAdmins(subject: string, lines: string[]): Promise<void> {
  try {
    const [{ default: prisma }, { addEmailJob }] = await Promise.all([
      import('../lib/prisma'),
      import('./queue'),
    ]);
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { email: true },
    });
    const body = lines.map((l) => `<p>${l.replace(/[<>&]/g, '')}</p>`).join('');
    await Promise.all(
      admins.map((a) =>
        addEmailJob({
          to: a.email,
          subject,
          html: `<div style="font-family:system-ui,sans-serif;line-height:1.6">${body}</div>`,
          text: lines.join('\n\n'),
          priority: 1,
        }),
      ),
    );
  } catch (err) {
    console.error('[aiHealth] could not email administrators:', (err as Error)?.message ?? err);
  }
}

export async function evaluateAlerts(): Promise<void> {
  if (process.env.NODE_ENV === 'test' && process.env.AI_ALERTS_IN_TESTS !== 'true') return;
  const { status, providers } = getAiHealth();
  if (status === 'down') {
    if (!(await claimAlertSlot())) return;
    downAlerted = true;
    console.error('[aiHealth] ALERT: AI triage is DOWN. Every new case is falling back to "no AI analysis".');
    await emailAdmins('URGENT: Ahava AI triage is down', [
      'AI triage analysis is currently unavailable. New patient cases are being routed to doctors WITHOUT an AI summary, flagged "AI analysis unavailable".',
      ...providers
        .filter((p) => p.configured && p.lastFailure)
        .map(
          (p) =>
            `${p.provider}: ${p.lastFailure!.kind}${p.lastFailure!.status ? ` (${p.lastFailure!.status})` : ''} on model ${p.lastFailure!.model}: ${p.lastFailure!.message}`,
        ),
      'Open the admin dashboard AI status, or check the API logs for "[aiHealth]". Cases are re-analysed automatically once a provider recovers.',
    ]);
  } else if (status === 'ok' && downAlerted) {
    downAlerted = false;
    await emailAdmins('Ahava AI triage has recovered', [
      'AI triage analysis is working again. Cases that were waiting without an AI summary are being re-analysed automatically.',
    ]);
  }
}

/** Test helper. */
export function _resetAiHealthForTests(): void {
  state.clear();
  modelHealth.clear();
  lastDownAlertAt = 0;
  downAlerted = false;
}
