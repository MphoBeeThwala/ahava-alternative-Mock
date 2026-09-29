/**
 * Written clinical content is encrypted at rest (lib/clinicalFieldEncryption.ts):
 * checked against the raw database columns, not just the Prisma result.
 */
import prisma from "./prisma";
import { encryptData } from "../utils/encryption";

async function makeUser(role: "PATIENT" | "NURSE" | "DOCTOR", label: string) {
  return prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      firstName: label,
      lastName: role,
      role,
    },
  });
}

describe("clinical notes are encrypted at rest", () => {
  it("stores triage notes and JSON as ciphertext and reads them back as plaintext", async () => {
    const patient = await makeUser("PATIENT", "enc-triage");
    const tc = await prisma.triageCase.create({
      data: {
        patientId: patient.id,
        symptoms: "Severe headache and blurred vision",
        aiTriageLevel: 3,
        aiRecommendedAction: "SEE_GP",
        aiReasoning: "Possible hypertensive urgency",
        aiPossibleConditions: ["Hypertension", "Migraine"],
      },
    });

    const [raw] = await prisma.$queryRaw<Array<{ symptoms: string; aiReasoning: string; aiPossibleConditions: unknown }>>`
      SELECT symptoms, "aiReasoning", "aiPossibleConditions" FROM triage_cases WHERE id = ${tc.id}`;
    expect(raw.symptoms.startsWith("v3:")).toBe(true);
    expect(raw.symptoms).not.toContain("headache");
    expect(JSON.stringify(raw.aiPossibleConditions)).not.toContain("Hypertension");

    expect(tc.symptoms).toBe("Severe headache and blurred vision");
    const read = await prisma.triageCase.findUniqueOrThrow({ where: { id: tc.id } });
    expect(read.aiReasoning).toBe("Possible hypertensive urgency");
    expect(read.aiPossibleConditions).toEqual(["Hypertension", "Migraine"]);
  });

  it("encrypts on update and decrypts nested includes (visit -> messages)", async () => {
    const patient = await makeUser("PATIENT", "enc-visit");
    const nurse = await makeUser("NURSE", "enc-visit-nurse");
    const booking = await prisma.booking.create({
      data: {
        patientId: patient.id,
        nurseId: nurse.id,
        encryptedAddress: encryptData("1 Enc Street"),
        scheduledDate: new Date(Date.now() + 3600_000),
        paymentMethod: "CARD",
        amountInCents: 100,
      },
    });
    const visit = await prisma.visit.create({ data: { bookingId: booking.id, nurseId: nurse.id, scheduledStart: booking.scheduledDate } });
    await prisma.visit.update({ where: { id: visit.id }, data: { nurseReport: "Wound dressed, healing well", treatment: { notes: "Paracetamol 1g" } } });
    await prisma.message.create({ data: { visitId: visit.id, senderId: nurse.id, recipientId: patient.id, content: "Arriving in 10 minutes" } });

    const [rawVisit] = await prisma.$queryRaw<Array<{ nurseReport: string; treatment: unknown }>>`
      SELECT "nurseReport", treatment FROM visits WHERE id = ${visit.id}`;
    const [rawMessage] = await prisma.$queryRaw<Array<{ content: string }>>`
      SELECT content FROM messages WHERE "visitId" = ${visit.id}`;
    expect(rawVisit.nurseReport).not.toContain("Wound");
    expect(JSON.stringify(rawVisit.treatment)).not.toContain("Paracetamol");
    expect(rawMessage.content).not.toContain("Arriving");

    const read = await prisma.visit.findUniqueOrThrow({ where: { id: visit.id }, include: { messages: true, booking: true } });
    expect(read.nurseReport).toBe("Wound dressed, healing well");
    expect(read.treatment).toEqual({ notes: "Paracetamol 1g" });
    expect(read.messages[0].content).toBe("Arriving in 10 minutes");
    // Other ciphertext (the address, its own AAD) is left for its own code path.
    expect(read.booking.encryptedAddress.startsWith("v3:")).toBe(true);
  });

  it("still reads legacy plaintext rows written before encryption was enabled", async () => {
    const patient = await makeUser("PATIENT", "enc-legacy");
    const tc = await prisma.triageCase.create({
      data: { patientId: patient.id, symptoms: "x", aiTriageLevel: 4, aiRecommendedAction: "SELF_CARE", aiReasoning: "x", aiPossibleConditions: [] },
    });
    await prisma.$executeRaw`UPDATE triage_cases SET symptoms = 'legacy plaintext cough' WHERE id = ${tc.id}`;

    const read = await prisma.triageCase.findUniqueOrThrow({ where: { id: tc.id } });
    expect(read.symptoms).toBe("legacy plaintext cough");
  });
});
