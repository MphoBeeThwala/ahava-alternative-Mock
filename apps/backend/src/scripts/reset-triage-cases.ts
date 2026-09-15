import 'dotenv/config';
import prisma from '../lib/prisma';

// Clears all AI-symptom-checker triage cases (both the patient-facing
// history and the doctor review queue) so the team can start fresh, without
// touching bookings/visits (nurse-dispatch workflow) or any monitoring data
// (BiometricReading/HealthAlert/UserBaseline).
//
// Deleting a TriageCase cascades (DB-level FK, see schema.prisma) to its
// Prescription and Referral, since those can only exist attached to a case.
//
// Safe by default: run with no arguments to see counts only. Pass
// --confirm to actually delete.
async function resetTriageCases() {
  const confirm = process.argv.includes('--confirm');

  const [caseCount, prescriptionCount, referralCount] = await Promise.all([
    prisma.triageCase.count(),
    prisma.prescription.count(),
    prisma.referral.count(),
  ]);

  console.log(`Found ${caseCount} triage case(s), ${prescriptionCount} prescription(s), ${referralCount} referral(s).`);

  if (!confirm) {
    console.log('Dry run only — nothing deleted. Re-run with --confirm to delete all of the above.');
    return;
  }

  if (caseCount === 0) {
    console.log('Nothing to delete.');
    return;
  }

  const result = await prisma.triageCase.deleteMany({});
  console.log(`Deleted ${result.count} triage case(s) (prescriptions and referrals cascaded automatically).`);
}

resetTriageCases()
  .catch((error) => {
    console.error('Reset failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
