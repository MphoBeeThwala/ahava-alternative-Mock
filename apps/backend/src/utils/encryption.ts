import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const keyLength = 32;
const ivLength = 12;
const ENCRYPTION_VERSION = 'v2';

export function generateEncryptionKey(): string {
  return crypto.randomBytes(keyLength).toString('base64');
}

export function generateIVSalt(): string {
  // Retained for backwards compatibility with legacy deployments that still read this env var.
  return crypto.randomBytes(16).toString('hex');
}

function getEncryptionKey(key?: string): Buffer {
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

function isHexString(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value);
}

export function isEncryptedPayload(value: string): boolean {
  if (!value || typeof value !== 'string') return false;

  const v2 = value.split(':');
  if (v2.length === 4 && v2[0] === ENCRYPTION_VERSION) {
    const [_, ivB64, tagB64, cipherB64] = v2;
    if (!ivB64 || !tagB64 || !cipherB64) return false;
    return true;
  }

  const legacy = value.split(':');
  if (legacy.length === 3) {
    const [ivHex, tagHex, cipherHex] = legacy;
    return Boolean(ivHex && tagHex && cipherHex && isHexString(ivHex) && isHexString(tagHex) && isHexString(cipherHex));
  }

  return false;
}

export function encryptData(plaintext: string, key?: string): string {
  const encryptionKey = getEncryptionKey(key);
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Versioned payload allows safe future upgrades:
  // v2:<iv_b64>:<tag_b64>:<ciphertext_b64>
  return [
    ENCRYPTION_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptData(encryptedData: string, key?: string): string {
  const encryptionKey = getEncryptionKey(key);

  const parts = encryptedData.split(':');

  // New format: v2:<iv_b64>:<tag_b64>:<ciphertext_b64>
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
