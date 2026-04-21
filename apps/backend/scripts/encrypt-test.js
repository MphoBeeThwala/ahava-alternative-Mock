// Quick script to encrypt test data
const crypto = require('crypto');
require('dotenv').config();

const algorithm = 'aes-256-gcm';
const key = Buffer.from(process.env.ENCRYPTION_KEY || '4P96MokjojOYM0ddwS7n9ljjwXctaa0SYAxm5SHJC68=', 'base64');
const ivSalt = Buffer.from(process.env.ENCRYPTION_IV_SALT || '15a00644246594a8854dd8678edc4f3c', 'hex');

function encryptData(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Combine IV, authTag, and encrypted data
  const combined = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  
  return combined;
}

const address = process.argv[2] || '123 Main Street, Johannesburg, 2000, South Africa';
const encrypted = encryptData(address);
console.log(encrypted);

