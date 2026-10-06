import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { Icd10Field } from './Icd10Field';
import AlertFeedback from './AlertFeedback';
import OutcomeRecorder from './OutcomeRecorder';
import ClinicianResearchNotice from './ClinicianResearchNotice';
import ResearchStatusCard from './ResearchStatusCard';
import { isValidIcd10 } from '../lib/api/research';

const recordOutcome = vi.fn();
const getResearchStatus = vi.fn();
vi.mock('../lib/api/research', async (orig) => ({
  ...(await orig<typeof import('../lib/api/research')>()),
  researchApi: { recordOutcome: (...a: unknown[]) => recordOutcome(...a) },
}));
vi.mock('../lib/api/admin', () => ({ adminApi: { getResearchStatus: (...a: unknown[]) => getResearchStatus(...a) } }));

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('isValidIcd10', () => {
  it.each(['I10', 'i10', 'E11.9', ' I21.9 ', 'G45', 'Z00.0'])('accepts %s', (c) => expect(isValidIcd10(c)).toBe(true));
  it.each(['', 'high blood pressure', 'I', '10', 'U07.1', 'I1000000'])('rejects %j', (c) => expect(isValidIcd10(c)).toBe(false));
});

describe('Icd10Field', () => {
  it('is quiet when blank (it is optional) and flags only a malformed entry', () => {
    const { rerender } = render(<Icd10Field value="" onChange={() => undefined} />);
    expect(screen.getByLabelText(/ICD-10 code/)).toHaveAttribute('aria-invalid', 'false');
    rerender(<Icd10Field value="I10" onChange={() => undefined} />);
    expect(screen.getByLabelText(/ICD-10 code/)).toHaveAttribute('aria-invalid', 'false');
    rerender(<Icd10Field value="hypertension" onChange={() => undefined} />);
    expect(screen.getByLabelText(/ICD-10 code/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/not a valid ICD-10 format/)).toBeInTheDocument();
  });
});

describe('AlertFeedback', () => {
  it('records an explicit answer for the patient, with today and the alert level', async () => {
    recordOutcome.mockResolvedValue({ success: true, captured: true });
    render(<AlertFeedback patientId="p1" alertLevel="RED" />);
    fireEvent.click(screen.getByRole('button', { name: 'Real concern' }));
    await waitFor(() => expect(recordOutcome).toHaveBeenCalledTimes(1));
    const arg = recordOutcome.mock.calls[0][0];
    expect(arg).toMatchObject({ patientId: 'p1', outcomeType: 'ALERT_CONFIRMED', alertLevel: 'RED' });
    expect(arg.outcomeDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks, noted.');
  });

  it('records nothing until the doctor clicks, and lets them change their answer', async () => {
    recordOutcome.mockResolvedValue({ success: true, captured: true });
    render(<AlertFeedback patientId="p1" alertLevel="YELLOW" />);
    expect(recordOutcome).not.toHaveBeenCalled(); // merely viewing is not an answer
    fireEvent.click(screen.getByRole('button', { name: 'Real concern' }));
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'False alarm' }));
    await waitFor(() => expect(recordOutcome).toHaveBeenCalledTimes(2));
    expect(recordOutcome.mock.calls[1][0].outcomeType).toBe('ALERT_DISMISSED');
    expect(screen.getByRole('button', { name: 'False alarm' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Real concern' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not claim success when it failed', async () => {
    recordOutcome.mockRejectedValue(new Error('500'));
    render(<AlertFeedback patientId="p1" alertLevel="RED" />);
    fireEvent.click(screen.getByRole('button', { name: 'False alarm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save/);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reveals nothing about the patient\'s research choice, whatever the server says', async () => {
    recordOutcome.mockResolvedValue({ success: true, captured: false, reason: 'no_consent' });
    render(<AlertFeedback patientId="p1" alertLevel="RED" />);
    fireEvent.click(screen.getByRole('button', { name: 'Real concern' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks, noted.');
    expect(document.body.textContent).not.toMatch(/consent|opted/i);
  });
});

describe('OutcomeRecorder', () => {
  it('sends only structured fields for this patient', async () => {
    recordOutcome.mockResolvedValue({ success: true, captured: true });
    render(<OutcomeRecorder patientId="p9" />);
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: 'CVD_EVENT' } });
    fireEvent.change(screen.getByLabelText(/Date it happened/), { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText(/ICD-10 code/), { target: { value: 'i21.9' } });
    fireEvent.change(screen.getByLabelText(/Confirmed by/), { target: { value: 'LAB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record outcome' }));
    await waitFor(() => expect(recordOutcome).toHaveBeenCalledTimes(1));
    expect(recordOutcome.mock.calls[0][0]).toEqual({ patientId: 'p9', outcomeType: 'CVD_EVENT', outcomeDay: '2026-09-20', basis: 'LAB', icd10: 'I21.9' });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved. Thank you.');
    expect(screen.queryByRole('textbox', { name: /notes|comment/i })).toBeNull(); // no free text
  });

  it('will not send a malformed code', () => {
    render(<OutcomeRecorder patientId="p9" />);
    fireEvent.change(screen.getByLabelText(/ICD-10 code/), { target: { value: 'chest pain' } });
    expect(screen.getByRole('button', { name: 'Record outcome' })).toBeDisabled();
    fireEvent.submit(screen.getByTestId('outcome-recorder'));
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason when it refuses (for example no active access)', async () => {
    recordOutcome.mockRejectedValue({ response: { data: { error: 'You do not currently have access to this patient’s record.' } } });
    render(<OutcomeRecorder patientId="p9" />);
    fireEvent.click(screen.getByRole('button', { name: 'Record outcome' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not currently have access/);
  });
});

describe('ClinicianResearchNotice', () => {
  it('tells doctors what happens, and that it is information rather than a request', () => {
    render(<ClinicianResearchNotice />);
    const text = screen.getByTestId('clinician-research-notice').textContent ?? '';
    for (const phrase of ['patients who have chosen to take part', 'Only your role is recorded, not your name', 'do not need to agree', 'cannot opt a patient in or out', 'never shown to patients']) {
      expect(text).toContain(phrase);
    }
  });
});

describe('ResearchStatusCard', () => {
  const status = {
    captureEnabled: true, consentVersion: '1.0', consentedPatients: 12, snapshots: 340, subjectsWithSnapshots: 10,
    outcomes: { TRIAGE_REVIEWED: 8, CVD_EVENT: 1 }, shadowPredictions: [],
    retention: { maxYears: 7, inactiveMonths: 24, lastRunAt: '2026-10-06T03:00:00Z' },
    outcomesRecordedByClinicianLast90Days: [{ clinicianId: 'd1', name: 'Dr Example', count: 4 }],
    firstObservedDay: '2026-10-01', lastObservedDay: '2026-10-06',
  };

  it('shows accrual and who is recording outcomes', async () => {
    getResearchStatus.mockResolvedValue(status);
    render(<ResearchStatusCard />);
    const card = await screen.findByTestId('research-status');
    expect(card).toHaveTextContent('Capture is on');
    expect(card).toHaveTextContent('12 patients have opted in');
    expect(card).toHaveTextContent('AI vs doctor triage reviews: 8');
    expect(card).toHaveTextContent('Dr Example: 4');
  });

  it('shows the retention policy in force and when it last ran', async () => {
    getResearchStatus.mockResolvedValue(status);
    render(<ResearchStatusCard />);
    const line = await screen.findByTestId('research-retention');
    expect(line).toHaveTextContent('kept for 7 years');
    expect(line).toHaveTextContent('nothing new for 24 months are removed');
    expect(line).not.toHaveTextContent('not yet');
  });

  it('says so when a retention rule is switched off or has never run', async () => {
    getResearchStatus.mockResolvedValue({ ...status, retention: { maxYears: null, inactiveMonths: null, lastRunAt: null } });
    render(<ResearchStatusCard />);
    const line = await screen.findByTestId('research-retention');
    expect(line).toHaveTextContent('unlimited number of years');
    expect(line).toHaveTextContent('not yet');
    expect(line).not.toHaveTextContent('are removed');
  });

  it('says plainly when capture is off and why', async () => {
    getResearchStatus.mockResolvedValue({ ...status, captureEnabled: false });
    render(<ResearchStatusCard />);
    expect(await screen.findByTestId('research-status')).toHaveTextContent(/Capture is OFF.*RESEARCH_PSEUDONYM_KEY/);
  });

  it('reports a load failure rather than showing zeros', async () => {
    getResearchStatus.mockRejectedValue(new Error('500'));
    render(<ResearchStatusCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load research status/);
  });
});
