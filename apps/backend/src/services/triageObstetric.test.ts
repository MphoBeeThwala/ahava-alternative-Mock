/**
 * Pregnancy danger signs. The floor must catch the maternal-care danger signs
 * however the woman words them and whatever her blood pressure reads, because
 * pre-eclampsia, eclampsia and HELLP can present with a normal pressure. And it
 * must not fire on denials, on non-pregnant patients, or on harmless words.
 * The AI prompt carries the matching reasoning rules.
 */
import { assessDeterministicRisk } from './triageSafety';

const FLAG = 'OBSTETRIC_DANGER_SIGN';
const level = (text: string) => assessDeterministicRisk(text).minTriageLevel;
const flagged = (text: string) => assessDeterministicRisk(text).hardFlags.includes(FLAG);

describe('obstetric danger signs raise the floor to SATS 2', () => {
  it.each([
    ["visual change, symptom after the pregnancy", "I'm 24 weeks pregnant. Since yesterday my vision has gone very blurry in both eyes."],
    ["visual change, symptom before the pregnancy", "My eyes have gone blurry since this morning, and I am 30 weeks pregnant."],
    ["gestation written as weeks/40", "Primigravida 34/40, new flashing lights in front of my eyes."],
    ["epigastric pain", "I am pregnant and have a pain in my upper abdomen that goes through to my back."],
    ["pain under the right ribs", "36 weeks pregnant, pain under my right ribs since last night."],
    ["right upper quadrant pain", "Antenatal patient with right upper quadrant pain and nausea."],
    ["vaginal bleeding", "Pregnant, 28 weeks, I noticed some vaginal bleeding today."],
    ["swelling of face and hands", "I'm 32 weeks pregnant and there is swelling of my face and hands."],
    ["jaundice in pregnancy", "I'm pregnant and my eyes have turned yellow eyes."],
    ["waters broke", "I am 30 weeks pregnant and I think my waters broke."],
    ["after delivery", "I gave birth 4 days ago and now I have a severe headache."],
    ["postpartum visual loss", "Postpartum day 3, I lost my vision in the right eye for a minute."],
  ])('%s', (_l, text) => {
    expect(level(text)).toBeLessThanOrEqual(2);
    expect(flagged(text)).toBe(true);
  });

  it('works whatever the blood pressure is (the sign is the point, not the reading)', () => {
    const text = 'I am 24 weeks pregnant and my vision is blurry.';
    const r = assessDeterministicRisk(text, { bloodPressureSystolic: 112, bloodPressureDiastolic: 70, heartRateResting: 80 }, { ageYears: 30 });
    expect(r.minTriageLevel).toBeLessThanOrEqual(2);
    expect(r.hardFlags).toContain(FLAG);
  });

  it('treats absent fetal movement as a danger sign even though it is worded as a negation', () => {
    for (const text of [
      'I am 36 weeks pregnant and there have been no fetal movements today.',
      "I'm pregnant and I haven't felt the baby move since last night.",
      'Pregnant, 38 weeks, the baby has stopped moving.',
      'I am 30 weeks pregnant with reduced foetal movements.',
    ]) expect(flagged(text)).toBe(true);
  });
});

describe('it does not fire when it should not', () => {
  it.each([
    ['a denied symptom', 'I am 24 weeks pregnant. No blurred vision, no headache, no bleeding. Just a sore back.'],
    ['a denied bleed worded another way', 'Pregnant at 20 weeks. Denies vaginal bleeding. Denies leaking fluid.'],
    ['not pregnant', 'My vision has gone blurry since this morning.'],
    ['pregnant, unrelated minor complaint', 'I am 14 weeks pregnant and have mild heartburn after meals.'],
    ['the word "fit" used normally', 'I am 20 weeks pregnant and I do not fit into my jeans any more.'],
    ['a question about a pregnancy test', 'I think I might want to take a pregnancy test next week, my knee is sore.'],
  ])('%s', (_l, text) => {
    expect(flagged(text)).toBe(false);
  });

  it('leaves a non-pregnant visual symptom to the existing rules rather than claiming it is obstetric', () => {
    expect(flagged('Sudden loss of vision in my left eye')).toBe(false);
  });
});

describe('the AI prompt carries the matching reasoning rules', () => {
  jest.mock('./evidenceProvider', () => ({
    combineEvidence: jest.fn().mockResolvedValue({ results: [], sourcesQueried: [], sourcesSucceeded: [] }),
    hasSufficientEvidence: () => false,
    getEvidenceSummary: () => 'none',
  }));

  it('tells the model that normal blood pressure does not exclude HELLP or pre-eclampsia, and not to be anchored by one reassuring value', async () => {
    const { analyzeSymptoms } = await import('./aiTriage');
    const env = { ...process.env };
    const original = global.fetch;
    process.env.ANTHROPIC_API_KEY = 'k';
    delete process.env.GEMINI_API_KEY;
    const f = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ triageLevel: 2, possibleConditions: ['x'], recommendedAction: 'y', reasoning: 'z', confidence: 0.8, uncertaintyFlags: [], evidenceSources: ['Patient Symptoms'], requiresDoctorReview: true }) }],
      stop_reason: 'end_turn',
    }), { status: 200 }));
    global.fetch = f as unknown as typeof fetch;
    try {
      await analyzeSymptoms({ symptoms: 'Pregnant 24 weeks, blurred vision.' });
      const prompt: string = JSON.parse(String(f.mock.calls[0][1]?.body)).messages[0].content[0].text;
      expect(prompt).toMatch(/pre-eclampsia, eclampsia, HELLP/);
      expect(prompt).toMatch(/NORMAL blood pressure/);
      expect(prompt).toMatch(/Do not let one reassuring value/);
      expect(prompt).toMatch(/level 1 when there is end-organ involvement/);
    } finally {
      global.fetch = original;
      process.env = env;
    }
  });
});
