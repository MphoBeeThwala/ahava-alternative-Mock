/**
 * Where the data-encryption key comes from (docs/SECURITY_RUNBOOK.md §1).
 *
 * ENCRYPTION_KEY_PROVIDER=aws-kms (recommended for production)
 *   Envelope encryption. The 32-byte data key that encrypts patient data is
 *   stored only in *wrapped* form (ENCRYPTION_KEY_CIPHERTEXT) — encrypted by
 *   a master key that never leaves AWS KMS. At startup the API asks KMS to
 *   unwrap it and keeps the result in memory (utils/encryption.ts). Anyone
 *   who reads the Railway variables, a backup, or a leaked .env gets only the
 *   wrapped key, which is useless without the AWS credentials and the KMS
 *   key policy's permission. Every unwrap is logged in AWS CloudTrail, and
 *   access can be cut off instantly by disabling the KMS key.
 *
 * ENCRYPTION_KEY_PROVIDER=env (default: local development, tests)
 *   The plaintext ENCRYPTION_KEY variable, as before. Allowed in production
 *   but logged as a warning.
 */
import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { setEncryptionKeyMaterial } from '../utils/encryption';

/**
 * Bound into every wrap/unwrap. KMS refuses to unwrap a key whose context
 * doesn't match, so a data key wrapped for something else can't be used
 * here, and the IAM policy can require exactly this context.
 */
export const KMS_ENCRYPTION_CONTEXT = { app: 'ahava-healthcare', purpose: 'patient-data-key' } as const;

type KmsLike = Pick<KMSClient, 'send'>;

async function unwrap(kms: KmsLike, wrappedB64: string, keyId: string | undefined, label: string): Promise<Buffer> {
  let blob: Buffer;
  try {
    blob = Buffer.from(wrappedB64, 'base64');
  } catch {
    throw new Error(`${label} is not valid base64`);
  }
  const out = await kms.send(new DecryptCommand({
    CiphertextBlob: blob,
    EncryptionContext: { ...KMS_ENCRYPTION_CONTEXT },
    // Pin the master key: refuse a blob wrapped by any other KMS key.
    ...(keyId ? { KeyId: keyId } : {}),
  }));
  if (!out.Plaintext) throw new Error(`KMS returned no key material for ${label}`);
  const key = Buffer.from(out.Plaintext);
  if (key.length !== 32) {
    key.fill(0);
    throw new Error(`${label} unwrapped to ${key.length} bytes; expected a 32-byte AES-256 key`);
  }
  return key;
}

/**
 * Resolve the data key(s) before the server starts accepting requests.
 * Throws — and the process should not start — if KMS is configured but the
 * key can't be unwrapped.
 */
export async function loadEncryptionKeys(options: { kmsClient?: KmsLike } = {}): Promise<'aws-kms' | 'env'> {
  const provider = (process.env.ENCRYPTION_KEY_PROVIDER || 'env').trim().toLowerCase();

  if (provider === 'env') {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[keys] ENCRYPTION_KEY is a plaintext environment variable. Move it to AWS KMS: docs/SECURITY_RUNBOOK.md §1.');
    }
    return 'env';
  }

  if (provider !== 'aws-kms') {
    throw new Error(`Unknown ENCRYPTION_KEY_PROVIDER "${provider}" (expected "aws-kms" or "env")`);
  }

  // Leaving the plaintext key in the environment would defeat the point.
  if (process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY_PREVIOUS) {
    throw new Error(
      'ENCRYPTION_KEY_PROVIDER=aws-kms but a plaintext ENCRYPTION_KEY / ENCRYPTION_KEY_PREVIOUS is still set. ' +
        'Delete the plaintext variables once ENCRYPTION_KEY_CIPHERTEXT is in place.',
    );
  }
  const wrapped = process.env.ENCRYPTION_KEY_CIPHERTEXT;
  if (!wrapped) throw new Error('ENCRYPTION_KEY_PROVIDER=aws-kms requires ENCRYPTION_KEY_CIPHERTEXT');

  const kms = options.kmsClient ?? new KMSClient({});
  const keyId = process.env.ENCRYPTION_KMS_KEY_ID || undefined;
  const current = await unwrap(kms, wrapped, keyId, 'ENCRYPTION_KEY_CIPHERTEXT');
  const previousWrapped = process.env.ENCRYPTION_KEY_PREVIOUS_CIPHERTEXT;
  const previous = previousWrapped
    ? await unwrap(kms, previousWrapped, keyId, 'ENCRYPTION_KEY_PREVIOUS_CIPHERTEXT')
    : undefined;

  setEncryptionKeyMaterial({ current, previous });
  current.fill(0);
  previous?.fill(0);
  console.log(`[keys] Data key unwrapped via AWS KMS${previous ? ' (plus previous key for rotation)' : ''}`);
  return 'aws-kms';
}
