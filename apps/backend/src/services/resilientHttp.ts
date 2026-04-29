import axios from 'axios';

type CircuitState = {
  failures: number;
  openedUntil: number;
};

type ResilienceOptions = {
  retries?: number;
  timeoutMs?: number;
  backoffMs?: number;
  circuitThreshold?: number;
  circuitOpenMs?: number;
  maxElapsedMs?: number;
};

const state = new Map<string, CircuitState>();

const defaults: Required<ResilienceOptions> = {
  retries: Math.max(0, parseInt(process.env.HTTP_RETRY_MAX_RETRIES ?? '2', 10) || 2),
  timeoutMs: Math.max(1000, parseInt(process.env.HTTP_RETRY_TIMEOUT_MS ?? '8000', 10) || 8000),
  backoffMs: Math.max(50, parseInt(process.env.HTTP_RETRY_BACKOFF_MS ?? '250', 10) || 250),
  circuitThreshold: Math.max(1, parseInt(process.env.HTTP_CIRCUIT_THRESHOLD ?? '5', 10) || 5),
  circuitOpenMs: Math.max(1000, parseInt(process.env.HTTP_CIRCUIT_OPEN_MS ?? '15000', 10) || 15000),
  maxElapsedMs: Math.max(1000, parseInt(process.env.HTTP_MAX_ELAPSED_MS ?? '30000', 10) || 30000),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const status = err.response?.status;
  if (!status) return true; // network/dns/timeout
  return status >= 500 || status === 429 || status === 408 || status === 425;
}

function getState(key: string): CircuitState {
  const existing = state.get(key);
  if (existing) return existing;
  const fresh = { failures: 0, openedUntil: 0 };
  state.set(key, fresh);
  return fresh;
}

export async function withResilientHttp<T>(
  key: string,
  operation: (timeoutMs: number) => Promise<T>,
  options: ResilienceOptions = {}
): Promise<T> {
  const cfg = { ...defaults, ...options };
  const circuit = getState(key);
  const now = Date.now();

  if (circuit.openedUntil > now) {
    const err = new Error(`Circuit open for ${key}`) as Error & { code?: string };
    err.code = 'CIRCUIT_OPEN';
    throw err;
  }

  let lastError: unknown;
  const startedAt = Date.now();
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    try {
      const response = await operation(cfg.timeoutMs);
      circuit.failures = 0;
      circuit.openedUntil = 0;
      return response;
    } catch (err) {
      lastError = err;
      const elapsed = Date.now() - startedAt;
      if (!shouldRetry(err) || attempt === cfg.retries || elapsed >= cfg.maxElapsedMs) break;
      const jitter = Math.floor(Math.random() * 100);
      await sleep(cfg.backoffMs * (attempt + 1) + jitter);
    }
  }

  circuit.failures += 1;
  if (circuit.failures >= cfg.circuitThreshold) {
    circuit.openedUntil = Date.now() + cfg.circuitOpenMs;
  }
  throw lastError;
}
