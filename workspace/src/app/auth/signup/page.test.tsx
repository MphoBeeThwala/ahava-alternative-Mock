import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import SignupPage from './page';

const push = vi.fn();
const register = vi.fn();
const give = vi.fn();
let googleSignedIn: (() => void) | undefined;

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ register }) }));
vi.mock('../../../lib/api/auth', () => ({ authApi: { getInvite: vi.fn() } }));
vi.mock('../../../lib/api/consent', () => ({ consentApi: { give: (...a: unknown[]) => give(...a) } }));
vi.mock('../../../components/GoogleSignInButton', () => ({
  default: (props: { onSignedIn: () => void }) => {
    googleSignedIn = props.onSignedIn;
    return <button type="button" onClick={() => props.onSignedIn()}>Continue with Google</button>;
  },
}));

function fillForm() {
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Thandi' } });
  fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Mokoena' } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'thandi@example.test' } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Str0ng!Passw0rd' } });
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: /Create Free Account/ }));

beforeEach(() => {
  vi.resetAllMocks();
  googleSignedIn = undefined;
  localStorage.setItem('user', JSON.stringify({ role: 'PATIENT' }));
  register.mockResolvedValue(undefined);
  give.mockResolvedValue({});
});
afterEach(cleanup);

describe('sign-up research opt-in', () => {
  it('is an unticked, optional checkbox that does not block creating an account', async () => {
    render(<SignupPage />);
    const box = screen.getByRole('checkbox', { name: /I agree that Ahava may keep a coded copy/ });
    expect(box).not.toBeChecked();
    expect(box).not.toBeRequired();
    expect(screen.getByTestId('signup-research-consent')).toHaveTextContent(/Optional/);

    fillForm();
    submit();
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0]).not.toHaveProperty('researchConsent'); // silence is "no"
    expect(register.mock.calls[0][0]).toMatchObject({ role: 'PATIENT', email: 'thandi@example.test' });
  });

  it('sends the choice with the sign-up only when ticked', async () => {
    render(<SignupPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree that Ahava may keep a coded copy/ }));
    fillForm();
    submit();
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0]).toMatchObject({ role: 'PATIENT', researchConsent: true });
  });

  it('shows the same wording as everywhere else, including what is not kept', () => {
    render(<SignupPage />);
    const text = screen.getByTestId('signup-research-consent').textContent ?? '';
    for (const phrase of ['What is not kept', 'Coded, not anonymous', 'Only from now', 'You can leave at any time']) {
      expect(text).toContain(phrase);
    }
  });

  it('honours a ticked box when the patient signs up with Google instead, and the dashboard still asks if that fails', async () => {
    render(<SignupPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree that Ahava may keep a coded copy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(give).toHaveBeenCalledWith('RESEARCH_DATA', '1.0'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/patient/dashboard'));

    // A failure to record must not strand the sign-in.
    push.mockClear();
    give.mockRejectedValueOnce(new Error('500'));
    await googleSignedIn?.();
    expect(push).toHaveBeenCalledWith('/patient/dashboard');
  });

  it('records nothing for a Google sign-up when the box was not ticked', async () => {
    render(<SignupPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/patient/dashboard'));
    expect(give).not.toHaveBeenCalled();
  });
});
