import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const keyLength = 32;
const ivLength = 16;

export function generateEncryptionKey(): string {
  return crypto.randomBytes(keyLength).toString('base64');
}

export function generateIVSalt(): string {
  return crypto.randomBytes(ivLength).toString('hex');
}

export function encryptData(plaintext: string, key?: string, ivSalt?: string): string {
  const encryptionKeyStr = key || process.env.ENCRYPTION_KEY;
  const ivSaltStr = ivSalt || process.env.ENCRYPTION_IV_SALT;
  
  if (!encryptionKeyStr || !ivSaltStr) {
    throw new Error('Encryption keys not configured');
  }

  const encryptionKey = Buffer.from(encryptionKeyStr, 'base64');
  const iv = Buffer.from(ivSaltStr, 'hex');
  
  const cipher = crypto.createCipher(algorithm, encryptionKey, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Combine IV, authTag, and encrypted data
  const combined = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  
  return combined;
}

export function decryptData(encryptedData: string, key: string): string {
  if (!process.env.ENCRYPTION_KEY || !process.env.ENCRYPTION_IV_SALT) {
    throw new Error('Encryption keys not configured');
  }

  const encryptionKey = Buffer.from(key, 'base64');
  
  // Split the combined data
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipher(algorithm, encryptionKey, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

export function hashSensitiveData(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function generateChecksum(data: any): string {
  const dataString = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(dataString).digest('hex');
}
