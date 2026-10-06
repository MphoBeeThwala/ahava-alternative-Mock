import {
  _resetAiHealthForTests, getAiHealth, recordFailure, recordProbe, recordSuccess,
} from './aiHealth';

const fail = (provider: 'claude' | 'gemini' = 'claude') =>
  recordFailure({ provider, model: 'm', kind: 'timeout', message: 'timed out' });

const env = { ...process.env };
beforeEach(() => {
  _resetAiHealthForTests();
  process.env.ANTHROPIC_API_KEY = 'k';
  delete process.env.GEMINI_API_KEY;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...env };
  jest.restoreAllMocks();
});

describe('aiHealth', () => {
  it('is unconfigured with no provider keys', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(getAiHealth().status).toBe('unconfigured');
  });

  it('treats one failure as a blip and two in a row as an outage', () => {
    expect(getAiHealth().status).toBe('ok');
    fail();
    expect(getAiHealth().status).toBe('ok');
    fail();
    expect(getAiHealth().status).toBe('down');
  });

  it('recovers on the next success', () => {
    fail(); fail();
    recordSuccess('claude', 'claude-opus-5-5');
    expect(getAiHealth().status).toBe('ok');
    expect(getAiHealth().providers.find((p) => p.provider === 'claude')!.workingModel).toBe('claude-opus-5-5');
  });

  it('is degraded, not down, while the other provider still works', () => {
    process.env.GEMINI_API_KEY = 'g';
    fail('claude'); fail('claude');
    expect(getAiHealth().status).toBe('degraded');
    fail('gemini'); fail('gemini');
    expect(getAiHealth().status).toBe('down');
  });

  it('counts a failed probe as trouble before any patient case hits it', () => {
    recordProbe('claude', { ok: false, error: 'HTTP 401 invalid x-api-key' });
    expect(getAiHealth().status).toBe('down');
    recordProbe('claude', { ok: true, models: ['claude-opus-5-5'] });
    expect(getAiHealth().status).toBe('ok');
  });

  it('keeps the last failure kind and a trimmed message, and nothing patient-specific', () => {
    recordFailure({ provider: 'claude', model: 'claude-opus-5-5', kind: 'model_not_found', status: 404, message: 'x'.repeat(1000) });
    const f = getAiHealth().providers.find((p) => p.provider === 'claude')!.lastFailure!;
    expect(f.kind).toBe('model_not_found');
    expect(f.message.length).toBeLessThan(300);
  });
});
