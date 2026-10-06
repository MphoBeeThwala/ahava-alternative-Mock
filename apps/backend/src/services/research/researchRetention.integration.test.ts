/**
 * Retention against a real database: old rows go, recent rows stay, people who
 * have gone quiet are removed whole, predictions go with their readings, the
 * run is audited with counts only, and nothing outside the research tables is touched.
 */
import prisma from "../../lib/prisma";
import { cutoffDay, lastRetentionRun, retentionConfig, runRetention } from "./researchRetention";
import { researchStatus } from "./researchCapture";

const NOW = new Date("2026-10-06T12:00:00Z");
const RUN = Math.random().toString(36).slice(2, 8);
const key = (n: string) => `ret-${RUN}-${n}`;
const day = (yearsAgo: number, monthsAgo = 0) => cutoffDay(NOW, yearsAgo, monthsAgo);
const cfg = (maxYears: number | null, inactiveMonths: number | null) => ({ maxYears, inactiveMonths, warnings: [] });

const snap = (subject: string, observedDay: Date, ref: string) =>
  prisma.researchSnapshot.create({
    data: { subjectKey: key(subject), sourceRef: `${key(subject)}-${ref}`, consentVersion: "1.0", observedDay, ageBand: "45-49", source: "wearable" },
  });
const outcome = (subject: string, outcomeDay: Date, ref: string) =>
  prisma.researchOutcome.create({
    data: { subjectKey: key(subject), sourceRef: `${key(subject)}-${ref}`, outcomeType: "CVD_EVENT", outcomeDay, source: "CLINICIAN_ENTRY", consentVersion: "1.0" },
  });
const countS = (subject: string) => prisma.researchSnapshot.count({ where: { subjectKey: key(subject) } });
const countO = (subject: string) => prisma.researchOutcome.count({ where: { subjectKey: key(subject) } });

afterAll(async () => {
  await prisma.researchSnapshot.deleteMany({ where: { subjectKey: { startsWith: `ret-${RUN}-` } } });
  await prisma.researchOutcome.deleteMany({ where: { subjectKey: { startsWith: `ret-${RUN}-` } } });
});

describe("age limit", () => {
  it("removes rows older than the limit, with their predictions, and keeps recent rows of the same active person", async () => {
    const old = await snap("age", day(8), "old");
    await snap("age", day(0, 1), "recent");
    await outcome("age", day(8), "old-o");
    await outcome("age", day(0, 1), "recent-o");
    await prisma.researchPrediction.create({ data: { snapshotId: old.id, modelName: "m", modelVersion: "v", target: "t", probability: 0.1 } });

    const r = await runRetention(NOW, cfg(7, null));
    expect(r.snapshots).toBeGreaterThanOrEqual(1);
    expect(await countS("age")).toBe(1);
    expect(await countO("age")).toBe(1);
    expect(await prisma.researchPrediction.count({ where: { snapshotId: old.id } })).toBe(0);
  });

  it("keeps a row exactly at the limit and removes the day before", async () => {
    await snap("edge", cutoffDay(NOW, 7), "at");
    await snap("edge", new Date(cutoffDay(NOW, 7).getTime() - 86_400_000), "before");
    await snap("edge", day(0, 1), "recent");
    await runRetention(NOW, cfg(7, null));
    const rows = await prisma.researchSnapshot.findMany({ where: { subjectKey: key("edge") }, orderBy: { observedDay: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].sourceRef.endsWith("-at")).toBe(true);
  });
});

describe("inactivity", () => {
  it("removes a person who has gone quiet entirely, including rows that are within the age limit", async () => {
    await snap("quiet", day(3), "a"); // 3 years ago: inside the 7-year limit, but nothing since
    await snap("quiet", day(2, 6), "b");
    await outcome("quiet", day(2, 6), "o");
    const r = await runRetention(NOW, cfg(7, 24));
    expect(r.inactiveSubjects).toBeGreaterThanOrEqual(1);
    expect(await countS("quiet")).toBe(0);
    expect(await countO("quiet")).toBe(0);
  });

  it("keeps someone with any recent reading or outcome, however old their other rows", async () => {
    await snap("active-s", day(5), "old");
    await snap("active-s", day(0, 3), "new");
    await outcome("active-o", day(0, 2), "recent-outcome-only"); // outcome-only person, recent
    await runRetention(NOW, cfg(7, 24));
    expect(await countS("active-s")).toBe(2);
    expect(await countO("active-o")).toBe(1);
  });

  it("a person's last activity is the later of their readings and outcomes", async () => {
    await snap("mixed", day(4), "old-reading");
    await outcome("mixed", day(0, 4), "recent-outcome"); // old reading, recent outcome: still active
    await runRetention(NOW, cfg(7, 24));
    expect(await countS("mixed")).toBe(1);
    expect(await countO("mixed")).toBe(1);
  });
});

describe("switches, repeats and side effects", () => {
  it('"off" for a rule leaves its data alone', async () => {
    await snap("off", day(9), "ancient");
    await snap("off2", day(3), "quiet");
    await runRetention(NOW, cfg(null, null));
    expect(await countS("off")).toBe(1);
    expect(await countS("off2")).toBe(1);
  });

  it("is idempotent", async () => {
    await snap("idem", day(9), "x");
    await runRetention(NOW, cfg(7, 24));
    const again = await runRetention(NOW, cfg(7, 24));
    expect(again).toEqual({ snapshots: 0, outcomes: 0, inactiveSubjects: 0 });
  });

  it("is audited with counts and settings only, and silent when nothing was removed", async () => {
    await prisma.auditLog.deleteMany({ where: { resource: "ResearchData", action: "DELETE", metadata: { path: ["event"], equals: "RETENTION_PURGE" } } });
    await runRetention(NOW, cfg(7, 24)); // nothing old left from earlier tests' perspective? make sure with a fresh state
    const before = await prisma.auditLog.count({ where: { resource: "ResearchData", metadata: { path: ["event"], equals: "RETENTION_PURGE" } } });
    await snap("audit", day(9), "x");
    await runRetention(NOW, cfg(7, 24));
    const rows = await prisma.auditLog.findMany({ where: { resource: "ResearchData", metadata: { path: ["event"], equals: "RETENTION_PURGE" } } });
    expect(rows.length).toBe(before + 1);
    const meta = rows[rows.length - 1].metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ event: "RETENTION_PURGE", maxYears: 7, inactiveMonths: 24 });
    expect(meta.snapshots).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(meta)).not.toMatch(/ret-|subjectKey|[0-9a-f]{64}/);
  });

  it("records when it last ran, and the admin status shows the settings and that time", async () => {
    await runRetention(NOW, cfg(7, 24));
    expect((await lastRetentionRun())?.toISOString()).toBe(NOW.toISOString());
    const status = await researchStatus();
    expect(status.retention).toMatchObject({ maxYears: 7, inactiveMonths: 24, lastRunAt: NOW.toISOString() });
  });

  it("touches nothing outside the research tables: consent records survive a purge", async () => {
    const user = await prisma.user.create({
      data: { email: `${key("u")}@example.test`, firstName: "R", lastName: "T", role: "PATIENT" },
    });
    await prisma.patientConsent.create({ data: { userId: user.id, consentType: "RESEARCH_DATA", version: "1.0", givenAt: day(8) } });
    await snap("consent", day(9), "x");
    await runRetention(NOW, cfg(7, 24));
    expect(await prisma.patientConsent.count({ where: { userId: user.id } })).toBe(1);
    await prisma.patientConsent.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("the shipped defaults are what the policy says", () => {
    expect(retentionConfig({} as NodeJS.ProcessEnv)).toMatchObject({ maxYears: 7, inactiveMonths: 24 });
  });
});
