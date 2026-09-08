import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const keyLength = 32;
const ivLength = 12;
// v2 payloads (no AAD, single key) are still decrypted for data written
// before AH-13. All new writes use v3 — see encryptData/decryptData below.
const ENCRYPTION_VERSION = 'v2';
const ENCRYPTION_VERSION_V3 = 'v3';
const DEFAULT_KEY_ID = 'default';

export function generateEncryptionKey(): string {
  return crypto.randomBytes(keyLength).toString('base64');
}

export function generateIVSalt(): string {
  // Retained for backwards compatibility with legacy deployments that still read this env var.
  return crypto.randomBytes(16).toString('hex');
}

export function getEncryptionKey(key?: string): Buffer {
  const encryptionKeyStr = key || process.env.ENCRYPTION_KEY;
  if (!encryptionKeyStr) {
    throw new Error('Encryption keys not configured');
  }
  const encryptionKey = Buffer.from(encryptionKeyStr, 'base64');
  if (encryptionKey.length !== keyLength) {
    throw new Error('Invalid ENCRYPTION_KEY length (expected 32-byte base64 key)');
  }
  return encryptionKey;
}

/**
 * AH-13 key rotation: ENCRYPTION_KEY_ID names which "generation" the current
 * ENCRYPTION_KEY is. New writes are always tagged with this id. A payload
 * tagged with ENCRYPTION_KEY_PREVIOUS_ID still decrypts with
 * ENCRYPTION_KEY_PREVIOUS, so both keys can be live during a rotation window
 * — rotate by setting *_PREVIOUS to today's values, then generating a new
 * ENCRYPTION_KEY/ENCRYPTION_KEY_ID.
 */
function getCurrentKeyId(): string {
  return process.env.ENCRYPTION_KEY_ID || DEFAULT_KEY_ID;
}

function resolveKeyForId(keyId: string, explicitKey?: string): Buffer {
  if (explicitKey) return getEncryptionKey(explicitKey);

  if (keyId === getCurrentKeyId()) {
    return getEncryptionKey();
  }

  const previousId = process.env.ENCRYPTION_KEY_PREVIOUS_ID;
  const previousKey = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (previousId && previousKey && keyId === previousId) {
    return getEncryptionKey(previousKey);
  }

  throw new Error(
    `No encryption key configured for key id "${keyId}". If this is data from ` +
      'before a key rotation, set ENCRYPTION_KEY_PREVIOUS_ID/ENCRYPTION_KEY_PREVIOUS to it.',
  );
}

function buildAAD(aad?: string): Buffer {
  return Buffer.from(aad ?? '', 'utf8');
}

function isHexString(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value);
}

export function isEncryptedPayload(value: string): boolean {
  if (!value || typeof value !== 'string') return false;

  const parts = value.split(':');

  if (parts[0] === ENCRYPTION_VERSION_V3 && parts.length === 5) {
    const [, keyId, ivB64, tagB64, cipherB64] = parts;
    return Boolean(keyId && ivB64 && tagB64 && cipherB64);
  }

  if (parts[0] === ENCRYPTION_VERSION && parts.length === 4) {
    const [, ivB64, tagB64, cipherB64] = parts;
    return Boolean(ivB64 && tagB64 && cipherB64);
  }

  if (parts.length === 3) {
    const [ivHex, tagHex, cipherHex] = parts;
    return Boolean(ivHex && tagHex && cipherHex && isHexString(ivHex) && isHexString(tagHex) && isHexString(cipherHex));
  }

  return false;
}

/**
 * Validate ENCRYPTION_KEY at boot.
 *
 * Without this the key is only touched the first time something is encrypted -
 * so a bad or missing key let the service start clean and then fail partway
 * through a booking, at the point of encrypting the patient's address.
 * Called from startServer().
 */
export function assertEncryptionKeyConfigured(): void {
  try {
    getEncryptionKey();
  } catch (error) {
    throw new Error(
      `ENCRYPTION_KEY is missing or invalid: ${(error as Error).message}. ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
}

/**
 * @param aad AH-13: binds the ciphertext to the context it was encrypted
 *   for (e.g. `user:${userId}:totpSecret`), so a value can't be silently
 *   moved between records or columns and still decrypt. Callers with no
 *   natural stable identifier at encryption time may omit it — that stays
 *   equivalent to the pre-AH-13 behaviour, just on the newer versioned
 *   format with key-rotation support. `decryptData` must be called with
 *   the exact same `aad` or decryption fails (GCM authentication).
 */
export function encryptData(plaintext: string, aad?: string, key?: string): string {
  const encryptionKey = getEncryptionKey(key);
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);
  cipher.setAAD(buildAAD(aad));

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // v3:<keyId>:<iv_b64>:<tag_b64>:<ciphertext_b64>
  return [
    ENCRYPTION_VERSION_V3,
    getCurrentKeyId(),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptData(encryptedData: string, aad?: string, key?: string): string {
  const parts = encryptedData.split(':');

  // v3:<keyId>:<iv_b64>:<tag_b64>:<ciphertext_b64> — current format, AAD-bound.
  if (parts.length === 5 && parts[0] === ENCRYPTION_VERSION_V3) {
    const [, keyId, ivB64, tagB64, cipherB64] = parts;
    const encryptionKey = resolveKeyForId(keyId, key);
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(cipherB64, 'base64');

    const decipher = crypto.createDecipheriv(algorithm, encryptionKey, iv);
    decipher.setAAD(buildAAD(aad));
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  const encryptionKey = getEncryptionKey(key);

  // v2:<iv_b64>:<tag_b64>:<ciphertext_b64> — pre-AH-13, no AAD, single key.
  if (parts.length === 4 && parts[0] === ENCRYPTION_VERSION) {
    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    const encrypted = Buffer.from(parts[3], 'base64');

    const decipher = crypto.createDecipheriv(algorithm, encryptionKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  // Legacy format fallback: <iv_hex>:<tag_hex>:<cipher_hex>
  if (parts.length === 3 && parts.every(Boolean)) {
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(algorithm, encryptionKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  throw new Error('Invalid encrypted data format');
}

export function hashSensitiveData(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function generateChecksum(data: any): string {
  const dataString = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(dataString).digest('hex');
}
