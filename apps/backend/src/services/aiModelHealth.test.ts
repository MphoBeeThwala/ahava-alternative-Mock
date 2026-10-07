/**
 * Which model goes first. The first live run of the diagnostic pack showed that
 * ONE slow Opus call made Sonnet the "working model" for every later case
 * (until the process restarted), silently, on the hardest cases. A model is now
 * demoted only when it is actually unhealthy: retired, or failing several
 * times in a row (a short-lived circuit breaker). One bad call demotes nothing.
 */
jest.mock('./evidenceProvider', () => ({
  combineEvidence: jest.fn().mockResolvedValue({ results: [], sourcesQueried: [], sourcesSucceeded: [] }),
  hasSufficientEvidence: () => false,
  getEvidenceSummary: () => 'none',
}));

import { analyzeSymptoms } from './aiTriage';
import { _resetAiHealthForTests } from './aiHealth';
import { effectiveChain } from './aiProviders';

const answer = {
  triageLevel: 2,
  possibleConditions: ['Cryptococcal meningitis'],
  recommendedAction: 'Emergency assessment.',
  reasoning: 'Headache, fever and drowsiness in an immunocompromised host.',
  confidence: 0.8,
  uncertaintyFlags: [],
  evidenceSources: ['Patient Symptoms'],
  requiresDoctorReview: true,
};
const ok = () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn' }), { status: 200 });
const serverError = () => new Response(JSON.stringify({ error: { type: 'api_error', message: 'internal error' } }), { status: 500 });
const notFound = () => new Response(JSON.stringify({ error: { type: 'not_found_error', message: 'model: not found' } }), { status: 404 });

let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit?]>;
const originalFetch = global.fetch;
const env = { ...process.env };
let clock = 0;
const realNow = Date.now.bind(Date);
const modelOfCall = (i: number): string => JSON.parse(String(fetchMock.mock.calls[i][1]?.body)).model;
let n = 0;
const run = () => analyzeSymptoms({ symptoms: `Headache and fever, drowsy for five days, case ${++n}` });

beforeEach(() => {
  _resetAiHealthForTests();
  process.env.ANTHROPIC_API_KEY = 'k';
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_CLAUDE_MODELS;
  process.env.AI_PROVIDER_RETRY_DELAY_MS = '0';
  process.env.AI_MODEL_CIRCUIT_THRESHOLD = '2';
  process.env.AI_MODEL_CIRCUIT_OPEN_MS = '60000';
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  clock = realNow();
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...env };
  jest.restoreAllMocks();
});

describe('one bad call does not demote the best model', () => {
  it('goes back to Opus for the next case after a single failed Opus case', async () => {
    // Case 1: Opus errors twice (one retry), Sonnet answers. Case 2: Opus is tried FIRST again.
    fetchMock.mockResolvedValueOnce(serverError()).mockResolvedValueOnce(serverError()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());

    const first = await run();
    const second = await run();

    expect(first.modelUsed).toBe('claude-sonnet-5-5');
    expect(modelOfCall(3)).toBe('claude-opus-5-5');
    expect(second.modelUsed).toBe('claude-opus-5-5');
  });

  it('a success clears the count, so failures that are not in a row never open the circuit', async () => {
    // fail (Opus x2, Sonnet ok) / Opus ok / fail again (Opus x2, Sonnet ok): two failures, not in a row
    fetchMock
      .mockResolvedValueOnce(serverError()).mockResolvedValueOnce(serverError()).mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(serverError()).mockResolvedValueOnce(serverError()).mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok());
    await run(); await run(); await run();

    const fourth = await run();

    expect(fourth.modelUsed).toBe('claude-opus-5-5');
    expect(effectiveChain('claude')[0]).toBe('claude-opus-5-5');
  });
});

describe('a model that keeps failing is skipped for a short while, then tried again', () => {
  it('opens after the threshold in a row, then closes after the cool-down', async () => {
    fetchMock
      .mockResolvedValueOnce(serverError()).mockResolvedValueOnce(serverError()).mockResolvedValueOnce(ok()) // case 1
      .mockResolvedValueOnce(serverError()).mockResolvedValueOnce(serverError()).mockResolvedValueOnce(ok()) // case 2: 2 in a row
      .mockResolvedValueOnce(ok()) // case 3: goes straight to Sonnet
      .mockResolvedValueOnce(ok()); // case 4: after the cool-down, Opus again
    await run();
    await run();
    expect(effectiveChain('claude')).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-5-5']);

    const third = await run();
    expect(modelOfCall(6)).toBe('claude-sonnet-5-5');
    expect(third.modelUsed).toBe('claude-sonnet-5-5');

    clock += 61_000;
    const fourth = await run();
    expect(modelOfCall(7)).toBe('claude-opus-5-5');
    expect(fourth.modelUsed).toBe('claude-opus-5-5');
    expect(effectiveChain('claude')[0]).toBe('claude-opus-5-5');
  });

  it('keeps a demoted model as the last resort rather than dropping it', async () => {
    fetchMock
      .mockResolvedValueOnce(serverError()).mockResolvedValueOnce(serverError()).mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(serverError()).mockResolvedValueOnce(serverError()).mockResolvedValueOnce(ok());
    await run(); await run();

    // Everything else is also failing now: the demoted Opus must still get a try.
    fetchMock.mockResolvedValueOnce(serverError()).mockResolvedValueOnce(serverError()) // sonnet-5-5
      .mockResolvedValueOnce(serverError()).mockResolvedValueOnce(serverError()) // sonnet-5
      .mockResolvedValueOnce(ok()); // opus, last resort
    const result = await run();

    expect(result.modelUsed).toBe('claude-opus-5-5');
  });
});

describe('a retired model is skipped for an hour', () => {
  it('stops trying a 404 model first, and tries it again after the demotion expires', async () => {
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    await run();

    await run();
    expect(modelOfCall(2)).toBe('claude-sonnet-5-5');

    clock += 61 * 60_000;
    await run();
    expect(modelOfCall(3)).toBe('claude-opus-5-5');
  });
});
