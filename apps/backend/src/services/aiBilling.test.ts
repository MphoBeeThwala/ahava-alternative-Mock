/**
 * "Your credit balance is too low to access the Anthropic API."
 *
 * After the diagnostic pack used up the production credit, every case failed and
 * the only trace was a generic `bad_request`: nothing said "out of credit", the
 * chain tried all three Claude models on the same empty account, and no one was
 * told until both providers had failed twice. An empty account, or a rejected
 * key, is now its own failure kind, stops the chain at once, and e-mails the
 * administrators on the FIRST failure.
 */
jest.mock('./evidenceProvider', () => ({
  combineEvidence: jest.fn().mockResolvedValue({ results: [], sourcesQueried: [], sourcesSucceeded: [] }),
  hasSufficientEvidence: () => false,
  getEvidenceSummary: () => 'none',
}));
jest.mock('./redis', () => ({ getRedis: () => { throw new Error('no redis in tests'); } }));
jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: { user: { findMany: jest.fn().mockResolvedValue([{ email: 'admin@example.test' }]) } },
}));
jest.mock('./queue', () => ({ addEmailJob: jest.fn().mockResolvedValue(undefined) }));

import { analyzeSymptoms } from './aiTriage';
import { _resetAiHealthForTests } from './aiHealth';
import { classifyHttpFailure } from './aiProviders';
import { addEmailJob } from './queue';

const CREDIT_BODY = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
  },
});
const GEMINI_429 =
  '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details.';

const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const sent = () => (addEmailJob as jest.Mock).mock.calls.map((c) => c[0] as { to: string; subject: string; text: string });

let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit?]>;
const originalFetch = global.fetch;
const env = { ...process.env };
let n = 0;
const run = () => analyzeSymptoms({ symptoms: `Headache and fever for three days, case ${++n}` });

beforeEach(() => {
  _resetAiHealthForTests();
  (addEmailJob as jest.Mock).mockClear();
  process.env.ANTHROPIC_API_KEY = 'k';
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_CLAUDE_MODELS;
  process.env.AI_PROVIDER_RETRY_DELAY_MS = '0';
  process.env.AI_ALERTS_IN_TESTS = 'true';
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...env };
  jest.restoreAllMocks();
});

describe('classifying an empty account', () => {
  it('recognises the Anthropic credit message (HTTP 400) and HTTP 402 as billing', () => {
    expect(classifyHttpFailure(400, CREDIT_BODY)).toBe('billing');
    expect(classifyHttpFailure(402, '')).toBe('billing');
  });

  it('does not mistake other failures for it', () => {
    expect(classifyHttpFailure(400, 'model: claude-x not found')).toBe('model_not_found');
    expect(classifyHttpFailure(400, 'messages: text content blocks must be non-empty')).toBe('bad_request');
    expect(classifyHttpFailure(401, 'invalid x-api-key')).toBe('auth');
  });

  it("keeps Google's transient per-minute 429 (which also says 'check your plan and billing details') as a rate limit", () => {
    expect(classifyHttpFailure(429, GEMINI_429)).toBe('rate_limited');
  });
});

describe('when the account is empty', () => {
  it('stops after one call instead of trying every model on the same account, and says why', async () => {
    fetchMock.mockResolvedValue(new Response(CREDIT_BODY, { status: 400 }));

    const result = await run();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.uncertaintyFlags).toContain('AI_ANALYSIS_UNAVAILABLE');
    expect(result.providerFailures).toHaveLength(1);
    expect(result.providerFailures![0]).toMatchObject({ provider: 'claude', kind: 'billing', status: 400 });
    expect(result.providerFailures![0].message).toMatch(/credit balance is too low/);
  });

  it('e-mails the administrators on the first failure, with what to do, and only once per cooldown', async () => {
    fetchMock.mockResolvedValue(new Response(CREDIT_BODY, { status: 400 }));

    await run();
    await flush();
    await run();
    await flush();

    const alerts = sent().filter((m) => /out of credit/.test(m.subject));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].to).toBe('admin@example.test');
    expect(alerts[0].subject).toMatch(/claude is out of credit/);
    expect(alerts[0].text).toMatch(/console\.anthropic\.com/);
    expect(alerts[0].text).toMatch(/auto-reload/);
  });

  it('also alerts at once when the key is rejected', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 }));

    await run();
    await flush();

    const alerts = sent().filter((m) => /rejected its API key/.test(m.subject));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].text).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('does not send an account alert for an ordinary slow or busy provider', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529 }));

    await run();
    await flush();

    expect(sent().filter((m) => /out of credit|rejected its API key/.test(m.subject))).toHaveLength(0);
  });
});
