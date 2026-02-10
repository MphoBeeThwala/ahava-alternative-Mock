#!/usr/bin/env node
/**
 * Validates required environment variables for production.
 * Run before deploy: node scripts/validate-env.js
 * Or with explicit env: NODE_ENV=production node scripts/validate-env.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.production') });

const isProduction = process.env.NODE_ENV === 'production';

const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'ENCRYPTION_IV_SALT',
];

const requiredInProduction = [
  ...required,
  'NODE_ENV',
];

const checks = isProduction ? requiredInProduction : required;
const missing = checks.filter((key) => {
  const v = process.env[key];
  return v === undefined || v === '' || (key === 'JWT_SECRET' && v.length < 32);
});

if (missing.length) {
  console.error('Missing or invalid required environment variables:', missing.join(', '));
  if (isProduction) {
    process.exit(1);
  }
  console.warn('Continuing in non-production mode.');
} else {
  console.log('Environment validation passed.');
}
