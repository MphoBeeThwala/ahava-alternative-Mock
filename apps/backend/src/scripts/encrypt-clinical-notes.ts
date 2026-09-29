/**
 * One-off backfill: encrypt written clinical content that was stored before
 * lib/clinicalFieldEncryption.ts was enabled. Safe to re-run — values that
 * are already encrypted are skipped. Dry run by default:
 *
 *   pnpm --filter backend encrypt:clinical-notes            # report only
 *   pnpm --filter backend encrypt:clinical-notes --apply    # encrypt
 *
 * Writes with raw SQL so rows keep their original `updatedAt`. Needs the
 * same ENCRYPTION_KEY as the running API.
 */
import { PrismaClient } from '@prisma/client';
import {
  ENCRYPTED_CLINICAL_FIELDS, encryptClinicalJson, encryptClinicalText,
} from '../lib/clinicalFieldEncryption';
import { assertEncryptionKeyConfigured, isEncryptedPayload } from '../utils/encryption';

// Fixed mapping (schema.prisma @@map) — never built from input.
const TABLES: Record<string, string> = {
  TriageCase: 'triage_cases',
  Visit: 'visits',
  Prescription: 'prescriptions',
  Referral: 'referrals',
  Message: 'messages',
};

const isEncryptedJson = (v: unknown) =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 1 && '__enc' in (v as object);

async function main() {
  const apply = process.argv.includes('--apply');
  assertEncryptionKeyConfigured();
  // The plain client, so we see what's really stored (the app's client
  // would hand back decrypted values).
  const db = new PrismaClient();
  let totalRows = 0;
  let totalFields = 0;

  try {
    for (const [model, spec] of Object.entries(ENCRYPTED_CLINICAL_FIELDS)) {
      const table = TABLES[model];
      const columns = [...(spec.text ?? []), ...(spec.json ?? [])];
      const select = ['id', ...columns].map((c) => `"${c}"`).join(', ');
      const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT ${select} FROM "${table}"`);
      let modelRows = 0;

      for (const row of rows) {
        const updates: Array<{ column: string; value: string; json: boolean }> = [];
        for (const column of spec.text ?? []) {
          const v = row[column];
          if (typeof v === 'string' && v.length > 0 && !isEncryptedPayload(v)) {
            updates.push({ column, value: encryptClinicalText(v), json: false });
          }
        }
        for (const column of spec.json ?? []) {
          const v = row[column];
          if (v !== null && v !== undefined && !isEncryptedJson(v)) {
            updates.push({ column, value: JSON.stringify(encryptClinicalJson(v)), json: true });
          }
        }
        if (updates.length === 0) continue;
        modelRows += 1;
        totalFields += updates.length;
        if (!apply) continue;
        const sets = updates.map((u, i) => `"${u.column}" = $${i + 1}${u.json ? '::jsonb' : ''}`).join(', ');
        await db.$executeRawUnsafe(
          `UPDATE "${table}" SET ${sets} WHERE id = $${updates.length + 1}`,
          ...updates.map((u) => u.value),
          row.id,
        );
      }
      totalRows += modelRows;
      console.log(`${model}: ${modelRows} of ${rows.length} rows ${apply ? 'encrypted' : 'need encrypting'}`);
    }
    console.log(`${apply ? 'Encrypted' : 'Would encrypt'} ${totalFields} field(s) across ${totalRows} row(s).${apply ? '' : ' Re-run with --apply to write.'}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
