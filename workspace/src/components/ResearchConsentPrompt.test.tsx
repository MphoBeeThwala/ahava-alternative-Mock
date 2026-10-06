import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import ResearchConsentPrompt from './ResearchConsentPrompt';
import { RESEARCH_CONSENT_VERSION } from './ResearchConsentCopy';

const getAll = vi.fn();
const give = vi.fn();
vi.mock('../lib/api', () => ({ consentApi: { getAll: (...a: unknown[]) => getAll(...a), give: (...a: unknown[]) => give(...a) } }));

const row = (over: Partial<{ consentType: string; version: string; withdrawn: boolean }> = {}) => ({
  consentType: 'RESEARCH_DATA', version: RESEARCH_CONSENT_VERSION, withdrawn: false, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});
afterEach(cleanup);

describe('ResearchConsentPrompt', () => {
  it('asks someone who has not answered', async () => {
    getAll.mockResolvedValue({ consents: [{ consentType: 'AI_TRIAGE', version: '1.0', withdrawn: false }] });
    render(<ResearchConsentPrompt />);
    expect(await screen.findByTestId('research-prompt')).toBeInTheDocument();
  });

  it.each([
    ['already agreed on the current wording', [row()]],
    ['agreed and later withdrew (that is an answer)', [row({ withdrawn: true })]],
  ])('stays quiet for someone who %s', async (_label, consents) => {
    getAll.mockResolvedValue({ consents });
    const { container } = render(<ResearchConsentPrompt />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('asks again when the wording has changed since they agreed', async () => {
    getAll.mockResolvedValue({ consents: [row({ version: '0.9' })] });
    render(<ResearchConsentPrompt />);
    expect(await screen.findByTestId('research-prompt')).toBeInTheDocument();
  });

  it('says nothing when it cannot tell whether they have answered', async () => {
    getAll.mockRejectedValue(new Error('offline'));
    const { container } = render(<ResearchConsentPrompt />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('is a question, not a gate: "Not now" hides it and remembers for 30 days without asking the server', async () => {
    getAll.mockResolvedValue({ consents: [] });
    const { unmount } = render(<ResearchConsentPrompt />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('research-prompt')).toBeNull();
    expect(give).not.toHaveBeenCalled();
    const until = Number(localStorage.getItem('ahava.researchPrompt.snoozedUntil'));
    expect(until - Date.now()).toBeGreaterThan(29 * 86_400_000);

    unmount();
    getAll.mockClear();
    const again = render(<ResearchConsentPrompt />);
    expect(again.container.innerHTML).toBe('');
    expect(getAll).not.toHaveBeenCalled(); // snoozed: not even a request
  });

  it('records a yes only after the explicit tick, at the current wording', async () => {
    getAll.mockResolvedValue({ consents: [] });
    give.mockResolvedValue({ success: true });
    render(<ResearchConsentPrompt />);
    const button = await screen.findByRole('button', { name: 'Take part' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    await waitFor(() => expect(give).toHaveBeenCalledWith('RESEARCH_DATA', RESEARCH_CONSENT_VERSION));
    expect(await screen.findByRole('status')).toHaveTextContent(/Thank you/);
  });

  it('keeps asking, with a clear message, if saving the yes failed', async () => {
    getAll.mockResolvedValue({ consents: [] });
    give.mockRejectedValue(new Error('500'));
    render(<ResearchConsentPrompt />);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Take part' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save/);
    expect(screen.getByTestId('research-prompt')).toBeInTheDocument();
  });
});
