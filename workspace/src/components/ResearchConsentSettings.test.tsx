import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import ResearchConsentSettings, { RESEARCH_CONSENT_VERSION } from './ResearchConsentSettings';

const getAll = vi.fn();
const give = vi.fn();
const withdraw = vi.fn();
vi.mock('../lib/api', () => ({
  consentApi: { getAll: (...a: unknown[]) => getAll(...a), give: (...a: unknown[]) => give(...a), withdraw: (...a: unknown[]) => withdraw(...a) },
}));

const consents = (...rows: Array<Partial<{ consentType: string; version: string; withdrawn: boolean }>>) => ({
  consents: rows.map((r) => ({ consentType: 'RESEARCH_DATA', version: RESEARCH_CONSENT_VERSION, withdrawn: false, ...r })),
});

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

describe('ResearchConsentSettings', () => {
  it('renders nothing when consent status cannot be loaded (never guess someone is or is not enrolled)', async () => {
    getAll.mockRejectedValue(new Error('offline'));
    const { container } = render(<ResearchConsentSettings />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('is opt-in: the button is disabled until the explicit agreement is ticked, then gives RESEARCH_DATA at the current wording', async () => {
    getAll.mockResolvedValue({ consents: [] });
    give.mockResolvedValue({ success: true });
    render(<ResearchConsentSettings />);
    const button = await screen.findByRole('button', { name: 'Take part' });
    expect(button).toBeDisabled();
    expect(give).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(give).toHaveBeenCalledWith('RESEARCH_DATA', RESEARCH_CONSENT_VERSION));
    expect(await screen.findByText(/You are taking part/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Nothing recorded before this moment is used/);
  });

  it('treats a withdrawn, or older-wording, agreement as not enrolled', async () => {
    getAll.mockResolvedValue(consents({ withdrawn: true }, { version: '0.1' }));
    render(<ResearchConsentSettings />);
    expect(await screen.findByRole('button', { name: 'Take part' })).toBeInTheDocument();
  });

  it('withdrawing asks first, then shows the server message about deletion', async () => {
    getAll.mockResolvedValue(consents({}));
    withdraw.mockResolvedValue({ message: 'Research consent withdrawn. Your readings and outcomes held for research have been deleted.' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ResearchConsentSettings />);
    const stop = await screen.findByRole('button', { name: /Stop taking part and delete my data/ });

    fireEvent.click(stop);
    expect(withdraw).not.toHaveBeenCalled(); // declined the confirmation

    confirm.mockReturnValue(true);
    fireEvent.click(stop);
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith('RESEARCH_DATA'));
    expect(await screen.findByRole('status')).toHaveTextContent(/have been deleted/);
    expect(screen.getByRole('button', { name: 'Take part' })).toBeInTheDocument();
  });

  it('keeps the person enrolled and says so if withdrawal fails', async () => {
    getAll.mockResolvedValue(consents({}));
    withdraw.mockRejectedValue(new Error('500'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ResearchConsentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /Stop taking part/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not withdraw/);
    expect(screen.getByText(/You are taking part/)).toBeInTheDocument();
  });

  it('says what is and is not kept, in plain words', async () => {
    getAll.mockResolvedValue({ consents: [] });
    render(<ResearchConsentSettings />);
    await screen.findByRole('button', { name: 'Take part' });
    const text = screen.getByTestId('research-consent').textContent ?? '';
    for (const phrase of ['What is not kept', 'name, contact details, ID number', 'Coded, not anonymous', 'Only from now', 'No effect on your care']) {
      expect(text).toContain(phrase);
    }
  });
});
