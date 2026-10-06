import type { CSSProperties } from 'react';

// Must match RESEARCH_CONSENT_VERSION in the backend (services/research/pseudonym.ts).
// Change both together when the wording below changes materially, so earlier
// agreements stop counting and people are asked again on the new wording.
export const RESEARCH_CONSENT_VERSION = '1.0';

// The wording on this page was approved by Ahava's legal adviser and Information
// Officer (confirmed by the project owner, 2026-10-06). It is shown in three
// places: sign-up, a one-time prompt after sign-in, and the Profile page. Keep
// them identical by editing only this file.

export const RESEARCH_TITLE = 'Help build better early warning for African patients (optional)';

export const RESEARCH_AGREE_TEXT =
  'I agree that Ahava may keep a coded copy of my readings and clinician-confirmed outcomes from now on, for developing and testing health tools, as described above. I understand I can withdraw at any time.';

const p: CSSProperties = { margin: '0 0 10px', fontSize: 13, color: '#57534e', lineHeight: 1.55 };

export function ResearchIntro() {
  return (
    <p style={p}>
      Most health prediction tools were built on data from other parts of the world and work less well for us. If you agree, Ahava will
      keep a coded copy of your readings and the outcomes your clinicians confirm, to help build and test future tools that are accurate
      for South African and African patients.
    </p>
  );
}

export function ResearchDetails() {
  return (
    <details style={{ marginBottom: 12 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Exactly what this means</summary>
      <ul style={{ ...p, paddingLeft: 18, marginTop: 8 }}>
        <li><strong>What is kept:</strong> your age group (5-year band), sex, the health history you entered (for example smoker or diabetes), your readings (heart rate, blood pressure, oxygen and similar), the date (not the time), and clinician-confirmed outcomes such as a diagnosis or hospital admission.</li>
        <li><strong>What is not kept:</strong> your name, contact details, ID number, address, location, messages, or anything you typed in your own words.</li>
        <li><strong>Coded, not anonymous:</strong> your data is stored under a code that only Ahava can link back to you, so that we can delete it if you withdraw. Because of that, it is still personal information under POPIA.</li>
        <li><strong>Only from now:</strong> readings recorded before you agree are never included.</li>
        <li><strong>No effect on your care:</strong> your care, alerts and results do not change, and nothing from this is shown to you or to a clinician. It is used to build and check tools in the background.</li>
        <li><strong>You can leave at any time:</strong> withdrawing stops new data and deletes what was captured.</li>
      </ul>
    </details>
  );
}
