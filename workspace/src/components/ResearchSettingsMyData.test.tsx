import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import ResearchConsentSettings from './ResearchConsentSettings';

const getAll = vi.fn();
const myData = vi.fn();
vi.mock('../lib/api', () => ({
  consentApi: { getAll: (...a: unknown[]) => getAll(...a), give: vi.fn(), withdraw: vi.fn() },
  researchApi: { myData: (...a: unknown[]) => myData(...a) },
}));

const enrolled = { consents: [{ consentType: 'RESEARCH_DATA', version: '1.0', withdrawn: false }] };
const data = (over = {}) => ({
  taking_part: true, since: '2026-10-01T00:00:00Z', captureEnabled: true, modelScoresComputed: 0,
  readings: [{ observedDay: '2026-10-02', ageBand: '45-49', sex: 'male', source: 'wearable', hrResting: 64 }],
  outcomes: [{ outcomeType: 'DEATH', outcomeDay: '2026-10-03', icd10: null, details: null, source: 'CLINICIAN_ENTRY' }],
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  getAll.mockResolvedValue(enrolled);
});
afterEach(cleanup);

describe('"what has been kept about me"', () => {
  it('is offered only to someone taking part, and loads nothing until they ask', async () => {
    getAll.mockResolvedValue({ consents: [] });
    render(<ResearchConsentSettings />);
    await screen.findByRole('button', { name: 'Take part' });
    expect(screen.queryByText(/what has been kept/i)).toBeNull();
    expect(myData).not.toHaveBeenCalled();
  });

  it('shows counts, offers a download, and never shows a model score', async () => {
    myData.mockResolvedValue(data({ modelScoresComputed: 3 }));
    render(<ResearchConsentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /See what has been kept about me/ }));
    const box = await screen.findByTestId('my-research-data');
    expect(box).toHaveTextContent('1 reading');
    expect(box).toHaveTextContent('1 clinician-confirmed outcome');
    expect(box).toHaveTextContent(/3 automated checks were run/);
    expect(box).toHaveTextContent(/not shown to you or your clinicians/);
    expect(box.textContent).not.toMatch(/\d\.\d+%|probab|risk of/i);
    expect(screen.getByRole('button', { name: 'Download a copy' })).toBeInTheDocument();
  });

  it('says so plainly when nothing has been kept yet, with no download offered', async () => {
    myData.mockResolvedValue(data({ readings: [], outcomes: [] }));
    render(<ResearchConsentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /See what has been kept about me/ }));
    expect(await screen.findByTestId('my-research-data')).toHaveTextContent('0 readings and 0 clinician-confirmed outcomes');
    expect(screen.queryByRole('button', { name: 'Download a copy' })).toBeNull();
  });

  it('reports a failure instead of showing an empty or wrong answer', async () => {
    myData.mockRejectedValue(new Error('500'));
    render(<ResearchConsentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /See what has been kept about me/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load/);
    await waitFor(() => expect(myData).toHaveBeenCalledTimes(1));
  });
});
