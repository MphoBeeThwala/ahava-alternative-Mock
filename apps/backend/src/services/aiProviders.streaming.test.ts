/**
 * The 2026-10 incident: two doctors' cases sat for hours as "AI ANALYSIS DID
 * NOT RUN" because every Claude call "timed out" and Gemini was overloaded.
 * What these pin down:
 *  - Claude is streamed, so a model that is still talking is never cut off by
 *    a fixed cap, while one that goes silent is cut off quickly;
 *  - a timeout is not retried on the same model (that doubled the wait);
 *  - after a slow or busy model, the next one is asked to think less;
 *  - one provider's budget is bounded, so it cannot starve the other;
 *  - a failure announced in the middle of a 200 response is still a failure.
 */
jest.mock('./evidenceProvider', () => ({
  combineEvidence: jest.fn().mockResolvedValue({ results: [], sourcesQueried: [], sourcesSucceeded: [] }),
  hasSufficientEvidence: () => false,
  getEvidenceSummary: () => 'none',
}));

import { analyzeSymptoms } from './aiTriage';
import { _resetAiHealthForTests } from './aiHealth';
import { effectiveLimits } from './aiProviders';

const CASE = 'Headache for three weeks, fever, vomiting, drowsy for five days, recurrent infections for twenty years.';
const answer = {
  triageLevel: 2,
  possibleConditions: ['Cryptococcal meningitis', 'Tuberculous meningitis'],
  recommendedAction: 'Emergency assessment and lumbar puncture.',
  reasoning: 'Headache, fever and drowsiness with recurrent infections suggest CNS infection in an immunocompromised host.',
  confidence: 0.8,
  uncertaintyFlags: [],
  evidenceSources: ['Patient Symptoms'],
  requiresDoctorReview: true,
};

const enc = new TextEncoder();
const sse = (type: string, payload: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const messageEvents = (text: string) => [
  sse('message_start', { message: { id: 'm' } }),
  sse('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }),
  sse('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'hmm {not json}' } }),
  sse('content_block_stop', { index: 0 }),
  sse('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
  ...text.match(/[\s\S]{1,37}/g)!.map((chunk) => sse('content_block_delta', { index: 1, delta: { type: 'text_delta', text: chunk } })),
  sse('content_block_stop', { index: 1 }),
  sse('message_delta', { delta: { stop_reason: 'end_turn' } }),
  sse('message_stop', {}),
];
const streamResponse = (chunks: string[]) =>
  new Response(
    new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
/** A response whose body says nothing, but honours the abort signal like a real socket. */
const silentResponse = (signal?: AbortSignal | null) =>
  new Response(
    new ReadableStream({
      start(c) { signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit?]>;
const originalFetch = global.fetch;
const env = { ...process.env };
const bodyOf = (i: number) => JSON.parse(String(fetchMock.mock.calls[i][1]?.body));

beforeEach(() => {
  _resetAiHealthForTests();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_CLAUDE_MODELS;
  process.env.AI_PROVIDER_RETRY_DELAY_MS = '0';
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...env };
  jest.restoreAllMocks();
});

describe('streamed answers', () => {
  it('asks for a stream and assembles the answer from text deltas, ignoring thinking', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(messageEvents(JSON.stringify(answer))));

    const result = await analyzeSymptoms({ symptoms: CASE });

    expect(bodyOf(0).stream).toBe(true);
    expect(result.modelUsed).toBe('claude-opus-5-5');
    expect(result.possibleConditions[0]).toBe('Cryptococcal meningitis');
    expect(result.uncertaintyFlags).not.toContain('AI_ANALYSIS_UNAVAILABLE');
  });

  it('copes with an event split across network chunks', async () => {
    const whole = messageEvents(JSON.stringify(answer)).join('');
    const cut = Math.floor(whole.length / 2) + 3;
    fetchMock.mockResolvedValueOnce(streamResponse([whole.slice(0, cut), whole.slice(cut)]));

    const result = await analyzeSymptoms({ symptoms: CASE });

    expect(result.modelUsed).toBe('claude-opus-5-5');
  });

  it('treats an error sent inside a 200 stream as a failure and retries a busy model once', async () => {
    fetchMock
      .mockResolvedValueOnce(streamResponse([sse('message_start', {}), sse('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })]))
      .mockResolvedValueOnce(streamResponse(messageEvents(JSON.stringify(answer))));

    const result = await analyzeSymptoms({ symptoms: CASE });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.modelUsed).toBe('claude-opus-5-5');
  });

  it('counts a stream cut off at max_tokens as a failure, not a half answer', async () => {
    const cutOff = messageEvents('{"triageLevel": 2, "possib').slice(0, -3).concat([sse('message_delta', { delta: { stop_reason: 'max_tokens' } }), sse('message_stop', {})]);
    fetchMock.mockResolvedValueOnce(streamResponse(cutOff)).mockResolvedValueOnce(streamResponse(messageEvents(JSON.stringify(answer))));

    const result = await analyzeSymptoms({ symptoms: CASE });

    expect(result.modelUsed).toBe('claude-sonnet-5-5');
    expect(result.providerFailures?.[0]).toMatchObject({ model: 'claude-opus-5-5', kind: 'truncated' });
  });
});

describe('timeouts', () => {
  it('cuts a connection that goes silent, does not retry that model, and asks the next one to think less', async () => {
    process.env.AI_PROVIDER_IDLE_TIMEOUT_MS = '2000';
    fetchMock
      .mockImplementationOnce(async (_u, init) => silentResponse(init?.signal))
      .mockResolvedValueOnce(streamResponse(messageEvents(JSON.stringify(answer))));

    const started = Date.now();
    const result = await analyzeSymptoms({ symptoms: CASE });

    expect(Date.now() - started).toBeLessThan(6_000);
    expect(fetchMock).toHaveBeenCalledTimes(2); // opus once, then sonnet: no second try of opus
    expect(bodyOf(0).model).toBe('claude-opus-5-5');
    expect(bodyOf(1).model).toBe('claude-sonnet-5-5');
    expect(bodyOf(0).output_config.effort).toBe('high');
    expect(bodyOf(1).output_config.effort).toBe('medium');
    expect(result.modelUsed).toBe('claude-sonnet-5-5');
    expect(result.providerFailures?.[0]).toMatchObject({ model: 'claude-opus-5-5', kind: 'timeout' });
    expect(result.providerFailures?.[0].message).toMatch(/no data from the provider/);
  }, 15_000);

  it('does not cut a model that keeps talking just because the whole call is slow', async () => {
    process.env.AI_PROVIDER_IDLE_TIMEOUT_MS = '2000';
    const events = messageEvents(JSON.stringify(answer));
    fetchMock.mockImplementationOnce(async () =>
      new Response(
        new ReadableStream({
          async start(c) {
            // 5 s in total, never silent for 2 s: a fixed 2 s cap would have killed this.
            for (let i = 0; i < 7; i++) { c.enqueue(enc.encode(': ping\n\n')); await new Promise((r) => setTimeout(r, 700)); }
            events.forEach((x) => c.enqueue(enc.encode(x)));
            c.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );

    const result = await analyzeSymptoms({ symptoms: CASE });

    expect(result.modelUsed).toBe('claude-opus-5-5');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('stops trying further models once the provider budget is spent, so the other provider gets its turn', async () => {
    process.env.AI_PROVIDER_TIMEOUT_MS = '2000';
    process.env.AI_CLAUDE_BUDGET_MS = '8000';
    fetchMock.mockImplementation(async (_u, init) => silentResponse(init?.signal));

    const started = Date.now();
    const result = await analyzeSymptoms({ symptoms: CASE });

    expect(Date.now() - started).toBeLessThan(8_000);
    expect(fetchMock).toHaveBeenCalledTimes(2); // after two 2 s timeouts under 5 s of the 8 s budget remain: the third model is not started
    expect(result.uncertaintyFlags).toContain('AI_ANALYSIS_UNAVAILABLE');
    expect(result.providerFailures?.map((f) => f.kind)).toEqual(['timeout', 'timeout']);
  }, 15_000);
});

describe('a stale environment variable cannot cripple triage', () => {
  const nodeEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = nodeEnv; });

  it('raises AI_PROVIDER_TIMEOUT_MS=12000 (the old hard-coded value) to the floor outside tests, and says so', () => {
    process.env.NODE_ENV = 'production';
    process.env.AI_PROVIDER_TIMEOUT_MS = '12000';
    process.env.AI_CLAUDE_BUDGET_MS = '20000';
    const limits = effectiveLimits();
    expect(limits.perCallMs).toBe(90_000);
    expect(limits.claudeBudgetMs).toBe(120_000);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/AI_PROVIDER_TIMEOUT_MS=12000 is too low/));
  });

  it('lets a higher value through untouched', () => {
    process.env.NODE_ENV = 'production';
    process.env.AI_PROVIDER_TIMEOUT_MS = '300000';
    expect(effectiveLimits().perCallMs).toBe(300_000);
  });

  it('uses the defaults when nothing is set', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AI_PROVIDER_TIMEOUT_MS;
    delete process.env.AI_CLAUDE_BUDGET_MS;
    expect(effectiveLimits()).toMatchObject({ perCallMs: 150_000, claudeBudgetMs: 200_000, geminiBudgetMs: 120_000 });
  });
});
