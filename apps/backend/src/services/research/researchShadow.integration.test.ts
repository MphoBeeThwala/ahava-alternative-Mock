/**
 * Shadow scoring against a real database with the ML service mocked at the
 * HTTP boundary: what is sent out (no identifiers, history strictly earlier),
 * what is stored, idempotence, and that an ML outage is harmless.
 */
import axios from "axios";
import prisma from "../../lib/prisma";
import { RESEARCH_CONSENT_VERSION } from "./pseudonym";
import { scoreUnscored } from "./researchShadow";

jest.mock("axios");
const mocked = axios as jest.Mocked<typeof axios>;

const SUBJECT = "shadow-test-subject-" + Math.random().toString(36).slice(2);
const MODEL = { name: "adverse_event_90d", version: "abc123", target: "adverse_event_90d" };

const mkSnap = (dayOffset: number, ref: string, hr: number) =>
  prisma.researchSnapshot.create({
    data: {
      subjectKey: SUBJECT, sourceRef: `${SUBJECT}-${ref}`, consentVersion: RESEARCH_CONSENT_VERSION,
      observedDay: new Date(Date.UTC(2026, 8, 1 + dayOffset)), ageBand: "45-49", sex: "male", hrResting: hr, source: "wearable",
    },
  });

beforeAll(() => {
  process.env.ML_SERVICE_URL = "http://ml.invalid";
  delete process.env.RESEARCH_SHADOW_ENABLED;
});
afterAll(async () => {
  await prisma.researchSnapshot.deleteMany({ where: { subjectKey: SUBJECT } });
});
beforeEach(async () => {
  jest.resetAllMocks();
  await prisma.researchSnapshot.deleteMany({ where: { subjectKey: SUBJECT } });
});

function mlReturns(prob = 0.07) {
  mocked.get.mockResolvedValue({ data: { models: [MODEL] } });
  mocked.post.mockImplementation(async (_url: string, body: any) => ({
    data: {
      results: body.items.map((i: any) => ({
        snapshot_id: i.snapshot_id,
        predictions: [{ ...{ model: MODEL.name, version: MODEL.version, target: MODEL.target }, probability: prob, contributions: [{ feature: "hr_resting", logit: 0.3 }] }],
      })),
    },
  }));
}

describe("scoreUnscored", () => {
  it("does nothing when no model is approved (the normal state today)", async () => {
    await mkSnap(0, "a", 60);
    mocked.get.mockResolvedValue({ data: { models: [] } });
    expect(await scoreUnscored()).toEqual({ scored: 0 });
    expect(mocked.post).not.toHaveBeenCalled();
    expect(await prisma.researchPrediction.count({ where: { snapshot: { subjectKey: SUBJECT } } })).toBe(0);
  });

  it("scores unscored snapshots, stores the prediction beside them, and never rescores", async () => {
    const s1 = await mkSnap(0, "a", 60);
    await mkSnap(1, "b", 62);
    mlReturns(0.07);
    const first = await scoreUnscored();
    expect(first.scored).toBeGreaterThanOrEqual(2);
    const stored = await prisma.researchPrediction.findMany({ where: { snapshotId: s1.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ modelName: MODEL.name, modelVersion: MODEL.version, probability: 0.07 });
    expect(stored[0].contributions).toEqual([{ feature: "hr_resting", logit: 0.3 }]);

    mocked.post.mockClear();
    await scoreUnscored();
    const rescored = mocked.post.mock.calls.flatMap((c: any[]) => c[1].items.map((i: any) => i.snapshot_id));
    expect(rescored).not.toContain(s1.id);
  });

  it("sends measurements and nothing that identifies a subject, with history from strictly earlier days", async () => {
    await mkSnap(0, "old1", 60);
    await mkSnap(3, "old2", 61);
    const target = await mkSnap(5, "now", 90);
    await mkSnap(5, "same-day", 91);
    await mkSnap(9, "future", 99);
    mlReturns();
    await scoreUnscored();

    const sent = mocked.post.mock.calls.flatMap((c: any[]) => c[1].items).find((i: any) => i.snapshot_id === target.id);
    expect(sent).toBeDefined();
    const wire = JSON.stringify(sent);
    expect(wire).not.toContain(SUBJECT);
    expect(wire).not.toContain("subjectKey");
    expect(wire).not.toContain("sourceRef");
    expect(sent.snapshot).toMatchObject({ hrResting: 90, observedDay: "2026-09-06", ageBand: "45-49" });
    expect(sent.history.map((h: any) => h.hrResting)).toEqual([60, 61]); // no same-day, no future
  });

  it("survives the ML service being down: no throw, nothing stored, retried next sweep", async () => {
    await mkSnap(0, "a", 60);
    mocked.get.mockResolvedValue({ data: { models: [MODEL] } });
    mocked.post.mockRejectedValue(new Error("ECONNREFUSED"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(scoreUnscored()).resolves.toMatchObject({ scored: 0 });
    warn.mockRestore();
    expect(await prisma.researchPrediction.count({ where: { snapshot: { subjectKey: SUBJECT } } })).toBe(0);

    mlReturns();
    expect((await scoreUnscored()).scored).toBeGreaterThanOrEqual(1);
  });

  it("ignores garbage probabilities from the ML side", async () => {
    await mkSnap(0, "a", 60);
    mlReturns(Number.NaN);
    await scoreUnscored();
    expect(await prisma.researchPrediction.count({ where: { snapshot: { subjectKey: SUBJECT } } })).toBe(0);
  });

  it("is off when switched off or when there is no ML service configured", async () => {
    await mkSnap(0, "a", 60);
    process.env.RESEARCH_SHADOW_ENABLED = "false";
    expect(await scoreUnscored()).toEqual({ scored: 0 });
    delete process.env.RESEARCH_SHADOW_ENABLED;
    delete process.env.ML_SERVICE_URL;
    expect(await scoreUnscored()).toEqual({ scored: 0 });
    process.env.ML_SERVICE_URL = "http://ml.invalid";
    expect(mocked.get).not.toHaveBeenCalled();
  });
});
