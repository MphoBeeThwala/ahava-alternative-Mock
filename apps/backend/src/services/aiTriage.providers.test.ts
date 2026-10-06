/**
 * Why AI triage failed on a complex neurological case, and why it can't
 * happen silently again. Each test pins one failure mode from the incident:
 *  - a `thinking` block before the text block (content[0].text was undefined);
 *  - a model name that 404s (retired/renamed): the next model must be tried;
 *  - output cut off at max_tokens;
 *  - a long case cut to 1,600 characters, losing the findings that matter;
 *  - attachments never reaching the model;
 *  - and, when nothing works, a keyword guess shown as a diagnosis
 *    ("Viral upper respiratory infection" at SATS 4 for a multiple-sclerosis
 *    case).
 * Evidence providers and the network are mocked; the rest is real.
 */
jest.mock('./evidenceProvider', () => ({
  combineEvidence: jest.fn().mockResolvedValue({ results: [], sourcesQueried: [], sourcesSucceeded: [] }),
  hasSufficientEvidence: () => false,
  getEvidenceSummary: () => 'none',
}));

import { analyzeSymptoms } from './aiTriage';
import { _resetAiHealthForTests, getAiHealth, getProviderState } from './aiHealth';
import {
  classifyHttpFailure, discoverBestModel, effectiveChain, extractJsonObject,
} from './aiProviders';
import { recordProbe } from './aiHealth';

const MS_CASE =
  'Painful loss of vision in my right eye over three days, tingling and numbness that comes and goes in different ' +
  'parts of my body, trouble walking and loss of balance, fatigue. MRI shows periventricular lesions and Dawson\'s fingers; ' +
  'CSF oligoclonal bands positive; HIV, Lyme and syphilis negative.';

const goodAnswer = {
  triageLevel: 3,
  possibleConditions: ['Multiple sclerosis (first demyelinating attack)', 'Neuromyelitis optica spectrum disorder'],
  recommendedAction: 'Urgent neurology review.',
  reasoning: 'Optic neuritis with periventricular lesions and positive oligoclonal bands favours MS.',
  confidence: 0.8,
  uncertaintyFlags: [],
  evidenceSources: ['Patient Symptoms'],
  requiresDoctorReview: true,
};

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;
let fetchMock: FetchMock;
const originalFetch = global.fetch;
const env = { ...process.env };

const claudeResponse = (answer: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({
    // The blocks current models really return: a thinking block, then text.
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(answer) }],
    stop_reason: 'end_turn',
    ...extra,
  }), { status: 200 });
const claudeError = (status: number, type = 'not_found_error') =>
  new Response(JSON.stringify({ error: { type, message: 'model: not found' } }), { status });
const bodyOf = (i: number) => JSON.parse(String(fetchMock.mock.calls[i][1]?.body));

beforeEach(() => {
  _resetAiHealthForTests();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.GEMINI_API_KEY;
  process.env.AI_PROVIDER_RETRY_DELAY_MS = '0';
  delete process.env.AI_CLAUDE_MODELS;
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...env };
  jest.restoreAllMocks();
});

describe('reading the model response', () => {
  it('finds the text block even when a thinking block comes first', async () => {
    fetchMock.mockResolvedValueOnce(claudeResponse(goodAnswer));

    const result = await analyzeSymptoms({ symptoms: MS_CASE });

    expect(result.modelUsed).toBe('claude-opus-5-5');
    expect(result.possibleConditions[0]).toMatch(/multiple sclerosis/i);
    expect(result.uncertaintyFlags).not.toContain('AI_ANALYSIS_UNAVAILABLE');
  });

  it('asks for enough output tokens that thinking cannot use them all up', async () => {
    fetchMock.mockResolvedValueOnce(claudeResponse(goodAnswer));
    await analyzeSymptoms({ symptoms: MS_CASE });
    expect(bodyOf(0).max_tokens).toBeGreaterThanOrEqual(8192);
  });

  it('copes with a reply wrapped in a code fence or prose', () => {
    expect(extractJsonObject('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('moves to the next model when output was cut off at max_tokens', async () => {
    fetchMock
      .mockResolvedValueOnce(claudeResponse({}, { stop_reason: 'max_tokens' }))
      .mockResolvedValueOnce(claudeResponse(goodAnswer));

    const result = await analyzeSymptoms({ symptoms: MS_CASE });

    expect(result.modelUsed).toBe('claude-sonnet-5-5');
    expect(getAiHealth().providers.find((p) => p.provider === 'claude')!.workingModel).toBe('claude-sonnet-5-5');
  });
});

describe('a model that no longer exists', () => {
  it('falls through to the next model instead of failing the case', async () => {
    fetchMock.mockResolvedValueOnce(claudeError(404)).mockResolvedValueOnce(claudeResponse(goodAnswer));

    const result = await analyzeSymptoms({ symptoms: MS_CASE });

    expect(result.modelUsed).toBe('claude-sonnet-5-5');
    expect(bodyOf(0).model).toBe('claude-opus-5-5');
    expect(bodyOf(1).model).toBe('claude-sonnet-5-5');
    expect(result.providerFailures?.[0]).toMatchObject({ model: 'claude-opus-5-5', kind: 'model_not_found', status: 404 });
  });

  it('tries the model that last worked first next time', async () => {
    fetchMock.mockResolvedValueOnce(claudeError(404)).mockResolvedValueOnce(claudeResponse(goodAnswer));
    await analyzeSymptoms({ symptoms: MS_CASE });

    fetchMock.mockResolvedValueOnce(claudeResponse(goodAnswer));
    await analyzeSymptoms({ symptoms: `${MS_CASE} (follow-up)` });

    expect(bodyOf(2).model).toBe('claude-sonnet-5-5');
  });

  it('does not keep trying other models after a bad API key', async () => {
    fetchMock.mockResolvedValue(claudeError(401, 'authentication_error'));

    const result = await analyzeSymptoms({ symptoms: MS_CASE });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.uncertaintyFlags).toContain('AI_ANALYSIS_UNAVAILABLE');
    expect(result.providerFailures?.[0].kind).toBe('auth');
  });

  it('retries a transient overload once on the same model before moving on', async () => {
    fetchMock.mockResolvedValueOnce(claudeError(529, 'overloaded_error')).mockResolvedValueOnce(claudeResponse(goodAnswer));

    const result = await analyzeSymptoms({ symptoms: MS_CASE });

    expect(result.modelUsed).toBe('claude-opus-5-5');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('choosing models from what the provider says it offers', () => {
  it('classifies HTTP failures', () => {
    expect(classifyHttpFailure(404, '')).toBe('model_not_found');
    expect(classifyHttpFailure(401, '')).toBe('auth');
    expect(classifyHttpFailure(429, '')).toBe('rate_limited');
    expect(classifyHttpFailure(529, '')).toBe('overloaded');
    expect(classifyHttpFailure(500, '')).toBe('server_error');
    expect(classifyHttpFailure(400, 'invalid model name')).toBe('model_not_found');
    expect(classifyHttpFailure(400, 'bad field')).toBe('bad_request');
  });

  it('routes around a configured model the provider no longer lists', () => {
    process.env.AI_CLAUDE_MODELS = 'claude-retired-1';
    recordProbe('claude', { ok: true, models: ['claude-opus-6', 'claude-sonnet-5-5', 'claude-haiku-4-5'] });

    const chain = effectiveChain('claude');

    // The newest listed Opus is discovered and tried before the dead name.
    expect(chain[0]).toBe('claude-sonnet-5-5');
    expect(chain).toContain('claude-opus-6');
    expect(chain.indexOf('claude-opus-6')).toBeLessThan(chain.indexOf('claude-retired-1'));
  });

  it('never discovers a restricted or small model family', () => {
    expect(discoverBestModel('claude', ['claude-fable-5-1', 'claude-mythos-5-1', 'claude-haiku-4-5'])).toBeNull();
    expect(discoverBestModel('gemini', ['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.6-flash-lite'])).toBe('gemini-3.6-flash');
  });
});

describe('long cases', () => {
  it('sends the whole case to the model, not the first 1,600 characters', async () => {
    fetchMock.mockResolvedValueOnce(claudeResponse(goodAnswer));
    const longCase = `${'Background history. '.repeat(250)} FINAL FINDING: CSF oligoclonal bands positive.`;

    await analyzeSymptoms({ symptoms: longCase });

    expect(longCase.length).toBeGreaterThan(5000);
    expect(JSON.stringify(bodyOf(0))).toContain('FINAL FINDING: CSF oligoclonal bands positive');
  });

  it('runs the safety rules on the full text even when the model says "mild"', async () => {
    fetchMock.mockResolvedValueOnce(claudeResponse({ ...goodAnswer, triageLevel: 5, possibleConditions: ['Tension headache'] }));
    const longCase = `${'Feeling a bit tired. '.repeat(120)} Painful loss of vision in the right eye.`;

    const result = await analyzeSymptoms({ symptoms: longCase });

    expect(result.triageLevel).toBeLessThanOrEqual(3);
    expect(result.uncertaintyFlags).toContain('NEUROLOGICAL_SYMPTOM_REVIEW');
  });

  it('flags, never hides, text beyond the analysis limit', async () => {
    fetchMock.mockResolvedValueOnce(claudeResponse(goodAnswer));

    const result = await analyzeSymptoms({ symptoms: 'x'.repeat(25_000) });

    expect(result.uncertaintyFlags).toContain('INPUT_TRUNCATED');
    expect(result.reasoning).toMatch(/not analysed/i);
    expect(JSON.stringify(bodyOf(0))).toContain('TEXT TRUNCATED');
  });
});

describe('attachments reach the model', () => {
  it('sends PDFs as documents and photos as images, and names them in the prompt', async () => {
    fetchMock.mockResolvedValueOnce(claudeResponse(goodAnswer));

    await analyzeSymptoms({
      symptoms: MS_CASE,
      imageBase64: 'data:image/jpeg;base64,/9j/AAAA',
      files: [{ fileName: 'mri-report.pdf', mimeType: 'application/pdf', base64: 'JVBERi0x' }],
    });

    const blocks = bodyOf(0).messages[0].content as Array<{ type: string; source?: { media_type: string } }>;
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'document']);
    expect(blocks[2].source?.media_type).toBe('application/pdf');
    expect((blocks[0] as unknown as { text: string }).text).toContain('mri-report.pdf');
  });
});

describe('when the model gives a vague answer', () => {
  it('keeps it and flags it, instead of swapping in a keyword guess', async () => {
    fetchMock.mockResolvedValueOnce(claudeResponse({ ...goodAnswer, possibleConditions: ['Acute undifferentiated illness'] }));

    const result = await analyzeSymptoms({ symptoms: 'fatigue and fever' });

    expect(result.possibleConditions).toEqual(['Acute undifferentiated illness']);
    expect(result.uncertaintyFlags).toContain('GENERIC_MODEL_OUTPUT');
    expect(result.possibleConditions.join()).not.toMatch(/viral|influenza/i);
  });
});

describe('when no AI provider works at all (the incident)', () => {
  it('invents no diagnosis and does not rate a neurological case non-urgent', async () => {
    fetchMock.mockResolvedValue(claudeError(500, 'api_error'));

    const result = await analyzeSymptoms({ symptoms: MS_CASE });

    expect(result.modelUsed).toMatch(/^no-ai-analysis/);
    expect(result.possibleConditions).toEqual(['AI analysis unavailable: no provisional diagnosis was generated']);
    expect(result.possibleConditions.join()).not.toMatch(/viral|influenza|bacterial|infection/i);
    expect(result.reasoning).not.toMatch(/likely viral/i);
    // "numbness" is already an urgent (SATS 2) rule, so this case is escalated, not downgraded.
    expect(result.triageLevel).toBeLessThanOrEqual(2);
    expect(result.confidence).toBe(0);
    expect(result.requiresDoctorReview).toBe(true);
    expect(result.uncertaintyFlags).toEqual(expect.arrayContaining(['AI_ANALYSIS_UNAVAILABLE', 'HIGH_RISK_SYMPTOM_PATTERN']));
    expect(result.recommendedAction).toMatch(/doctor must read the full history/i);
  });

  it('rates a neurological description with no other red flag SATS 3, flagged, never 4 or 5', async () => {
    fetchMock.mockResolvedValue(claudeError(500, 'api_error'));
    const result = await analyzeSymptoms({ symptoms: 'Painful loss of vision in the right eye, trouble walking, and fatigue.' });
    expect(result.triageLevel).toBe(3);
    expect(result.uncertaintyFlags).toContain('NEUROLOGICAL_SYMPTOM_REVIEW');
  });

  it('keeps the emergency screen: an affirmed red flag is SATS 1 even with no AI, still without a diagnosis', async () => {
    fetchMock.mockResolvedValue(claudeError(500, 'api_error'));
    const result = await analyzeSymptoms({ symptoms: 'Sudden crushing chest pain radiating to my left arm.' });
    expect(result.triageLevel).toBe(1);
    expect(result.uncertaintyFlags).toContain('EMERGENCY_RED_FLAG_NO_AI');
    expect(result.recommendedAction).toMatch(/possible emergency/i);
    expect(result.possibleConditions).toEqual(['AI analysis unavailable: no provisional diagnosis was generated']);
  });

  it('does not treat a denied red flag as an emergency', async () => {
    fetchMock.mockResolvedValue(claudeError(500, 'api_error'));
    const result = await analyzeSymptoms({ symptoms: 'A bit anxious. No chest pain, no shortness of breath.' });
    expect(result.uncertaintyFlags).not.toContain('EMERGENCY_RED_FLAG_NO_AI');
    expect(result.triageLevel).toBeGreaterThan(1);
  });

  it('is never rated less urgent than SATS 3, even for a bland description', async () => {
    fetchMock.mockResolvedValue(claudeError(500, 'api_error'));
    const result = await analyzeSymptoms({ symptoms: 'a bit tired and a runny nose' });
    expect(result.triageLevel).toBeLessThanOrEqual(3);
  });

  it('records why, in the health summary, with a failure kind', async () => {
    fetchMock.mockResolvedValue(claudeError(404));
    await analyzeSymptoms({ symptoms: MS_CASE });
    await analyzeSymptoms({ symptoms: `${MS_CASE} again` });

    const claude = getProviderState('claude');
    expect(claude.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(claude.lastFailure?.kind).toBe('model_not_found');
    expect(getAiHealth().status).toBe('down');
  });

  it('says plainly when no provider is configured at all', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await analyzeSymptoms({ symptoms: MS_CASE });
    expect(result.reasoning).toMatch(/no AI provider is configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
