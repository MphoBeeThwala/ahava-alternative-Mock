/**
 * Reference data the pipeline injects into the prompt or checks against:
 *  - test limitations ("when a negative result cannot exclude disease")
 *  - the dose table (empty until a clinician populates it; the model never writes doses)
 *
 * Both files carry a sign-off status that is surfaced to the reviewing doctor.
 */
import testLimitationsFile from './reference/testLimitations.json';
import doseTableFile from './reference/doseTable.json';
import { COMPLETENESS_RULES_VERSION, COMPLETENESS_RULES_SIGNOFF } from './completenessLinter';

export interface TestLimitation {
  id: string;
  test: string;
  aliases: string[];
  alwaysShowWhenCd4Below?: number;
  limitation: string;
  implication: string;
  sources: string[];
  signoff: string;
}

const LIMITATIONS = (testLimitationsFile as unknown as { entries: TestLimitation[] }).entries;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Entries for tests the case mentions, plus the ones that always matter at the patient's CD4. */
export function selectTestLimitations(caseText: string, cd4: number | null): TestLimitation[] {
  const text = caseText.toLowerCase();
  return LIMITATIONS.filter((e) => {
    const mentioned = e.aliases.some((a) => new RegExp(`(?<![a-z])${escapeRe(a)}(?![a-z])`, 'i').test(text));
    const cd4Triggered = e.alwaysShowWhenCd4Below !== undefined && cd4 !== null && cd4 < e.alwaysShowWhenCd4Below;
    return mentioned || cd4Triggered;
  });
}

export function renderTestLimitations(entries: TestLimitation[]): string {
  return entries
    .map((e) => `- ${e.test}: ${e.limitation} Implication: ${e.implication}`)
    .join('\n');
}

// ---- doses ----------------------------------------------------------------------

export interface DoseEntry {
  drug: string;
  indication: string;
  population: string;
  dose: string;
  source: string;
  reviewedBy: string;
  reviewedOn: string;
}

const DOSES = (doseTableFile as unknown as { entries: DoseEntry[] }).entries;
const DOSE_POINTER = (doseTableFile as { defaultPointer: string }).defaultPointer;

/**
 * What the clinician view shows for a drug: a cited dose from the table if one
 * exists, otherwise only a pointer to the guideline. Never a model-written number.
 */
export function doseReference(drug: string): { text: string; cited: boolean; source: string | null } {
  const hit = DOSES.find((d) => d.drug.toLowerCase() === drug.trim().toLowerCase());
  if (hit) return { text: hit.dose, cited: true, source: `${hit.source} (reviewed by ${hit.reviewedBy}, ${hit.reviewedOn})` };
  return { text: DOSE_POINTER, cited: false, source: null };
}

export const referenceVersions = () => ({
  completenessRules: { version: COMPLETENESS_RULES_VERSION, signoff: COMPLETENESS_RULES_SIGNOFF },
  testLimitations: {
    version: (testLimitationsFile as { version: string }).version,
    signoff: (testLimitationsFile as { signoff: string }).signoff,
  },
  doseTable: {
    version: (doseTableFile as { version: string }).version,
    signoff: (doseTableFile as { signoff: string }).signoff,
    entries: DOSES.length,
  },
});
