/**
 * Move the EXISTING data key into AWS KMS (docs/SECURITY_RUNBOOK.md §1).
 *
 * Wraps the current plaintext ENCRYPTION_KEY with your KMS master key and
 * prints ENCRYPTION_KEY_CIPHERTEXT for Railway. The data key itself does
 * not change, so everything already encrypted stays readable — nothing is
 * re-encrypted. Run it once, from a trusted machine, with AWS credentials
 * allowed to kms:Encrypt (an administrator's, NOT the API's decrypt-only
 * credentials):
 *
 *   ENCRYPTION_KEY='<current key>' ENCRYPTION_KMS_KEY_ID='alias/ahava-patient-data' \
 *   AWS_REGION=af-south-1 pnpm --filter backend wrap-encryption-key
 *
 * It unwraps the result again and checks it matches before printing it.
 * Pass --previous to wrap ENCRYPTION_KEY_PREVIOUS the same way.
 */
import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { KMS_ENCRYPTION_CONTEXT } from '../lib/keyManagement';

export async function wrapDataKey(kms: Pick<KMSClient, 'send'>, keyId: string, plaintextKeyB64: string): Promise<string> {
  const key = Buffer.from(plaintextKeyB64, 'base64');
  if (key.length !== 32) throw new Error(`Key is ${key.length} bytes; expected a 32-byte base64 AES-256 key`);
  try {
    const wrapped = await kms.send(new EncryptCommand({ KeyId: keyId, Plaintext: key, EncryptionContext: { ...KMS_ENCRYPTION_CONTEXT } }));
    if (!wrapped.CiphertextBlob) throw new Error('KMS returned no ciphertext');
    const check = await kms.send(new DecryptCommand({ CiphertextBlob: wrapped.CiphertextBlob, KeyId: keyId, EncryptionContext: { ...KMS_ENCRYPTION_CONTEXT } }));
    if (!check.Plaintext || !Buffer.from(check.Plaintext).equals(key)) {
      throw new Error('Round-trip check failed: the wrapped key does not unwrap to the original');
    }
    return Buffer.from(wrapped.CiphertextBlob).toString('base64');
  } finally {
    key.fill(0);
  }
}

async function main() {
  const previous = process.argv.includes('--previous');
  const plaintext = previous ? process.env.ENCRYPTION_KEY_PREVIOUS : process.env.ENCRYPTION_KEY;
  const keyId = process.env.ENCRYPTION_KMS_KEY_ID;
  if (!plaintext) throw new Error(`Set ${previous ? 'ENCRYPTION_KEY_PREVIOUS' : 'ENCRYPTION_KEY'} to the key to wrap.`);
  if (!keyId) throw new Error('Set ENCRYPTION_KMS_KEY_ID to your KMS key (ARN, key id, or alias/...).');

  const wrapped = await wrapDataKey(new KMSClient({}), keyId, plaintext);
  console.log('Wrapped and verified. Set this in Railway on the backend service:\n');
  console.log(`${previous ? 'ENCRYPTION_KEY_PREVIOUS_CIPHERTEXT' : 'ENCRYPTION_KEY_CIPHERTEXT'}=${wrapped}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
