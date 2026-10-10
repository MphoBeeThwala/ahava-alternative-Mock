import fs from 'fs';
import path from 'path';
import { packCaseToEvalCase, applyJudgement } from './packCases';
import { scoreRawOutput, SECTIONS } from './clinicalEval';
import { goodPlan } from '../services/clinical/testFixtures';
import type { PackCase } from '../services/diagnosticPack';

const pack = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../docs/diagnostic-test-pack/ahava-diagnostic-test-cases.json'), 'utf8')) as { cases: PackCase[] };

describe('published pack cases in the clinical evaluation', () => {
  it('adapts every pack case with structured findings and the case minimum urgency', () => {
    for (const c of pack.cases) {
      const e = packCaseToEvalCase(c);
      expect(e.input.caseText.length).toBeGreaterThan(50);
      const urgency = e.rubric.safety!.find((i) => i.id === 'saf_urgency') as { level: number };
      expect(urgency.level).toBe(c.answerKey.minimumAcceptableLevel);
    }
  });

  it('feeds lab values through as structured findings (unit-converted)', () => {
    const c = pack.cases.find((x) => x.id === 'AHV-DX-01')!;
    const e = packCaseToEvalCase(c);
    expect(e.input.findings).toMatchObject({ haemoglobinGdl: 10, neutrophilsX10e9: 0.3, plateletsX10e9: 230, cd4Cells: 188 });
  });

  it('scores the diagnosis section from the judge, and leaves it unscored without one', () => {
    const e = packCaseToEvalCase(pack.cases[0]);
    const base = scoreRawOutput(e, goodPlan());
    expect(base.sections.diagnosis.score).toBeNull();
    const judged = applyJudgement(base, {
      diagnosis: 'full', fellForPitfall: false, note: '',
      mustDetect: pack.cases[0].answerKey.mustDetect.map((item, i) => ({ item, covered: i === 0 })),
    });
    expect(judged.sections.diagnosis.score).toBeGreaterThan(0.4);
    expect(judged.sections.diagnosis.score).toBeLessThan(1);
    for (const s of SECTIONS) expect(judged.sections[s].items).toBeDefined();
    expect(applyJudgement(base, undefined)).toBe(base);
  });
});
