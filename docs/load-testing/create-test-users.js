/**
 * Create synthetic PATIENT test accounts for load testing
 * 
 * This script:
 * - Creates 100+ synthetic patients with realistic but non-real data
 * - Uses non-real email addresses (@test.local, @loadtest.mock)
 * - Generates strong passwords meeting complexity requirements
 * - Stores credentials in a JSON file for k6 to read
 * - Does NOT print credentials to logs
 * 
 * Usage:
 *   node create-test-users.js \
 *     --count 100 \
 *     --backend-url http://localhost:4000 \
 *     --output test-credentials.json \
 *     --db-url "postgresql://user:pass@localhost:5432/ahava_staging"
 * 
 * Requirements:
 *   - Node.js with @faker-js/faker installed
 *   - Access to the staging database
 *   - Backend API running and accessible
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { faker } = require('@faker-js/faker');

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : defaultValue;
};

const COUNT = parseInt(getArg('count', '100'), 10);
const BACKEND_URL = getArg('backend-url', 'http://localhost:4000');
const OUTPUT_FILE = getArg('output', './test-credentials.json');

console.log(`[*] Creating ${COUNT} synthetic test patient accounts...`);
console.log(`[*] Backend URL: ${BACKEND_URL}`);
console.log(`[*] Output file: ${OUTPUT_FILE}`);

// Validate backend connectivity
async function validateBackend() {
  return new Promise((resolve, reject) => {
    const healthUrl = new URL('/health', BACKEND_URL);
    const client = healthUrl.protocol === 'https:' ? https : http;
    
    const req = client.get(healthUrl, { timeout: 5000 }, (res) => {
      if (res.statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`Backend health check failed: ${res.statusCode}`));
      }
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Backend health check timeout'));
    });
  });
}

/**
 * Register a single test patient
 */
async function createTestPatient(index) {
  return new Promise((resolve, reject) => {
    // Generate realistic but non-real data
    const firstName = faker.name.firstName();
    const lastName = faker.name.lastName();
    const email = `patient-loadtest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}@test.local`;
    
    // Password must meet: 8+ chars, uppercase, digit, special char
    const password = `TestPass${Math.floor(Math.random() * 9000) + 1000}!`;
    
    const payload = JSON.stringify({
      firstName,
      lastName,
      email,
      password,
      role: 'PATIENT',
      dateOfBirth: faker.date.birthdate({ min: 18, max: 80 }),
      gender: faker.datatype.boolean() ? 'M' : 'F',
      phone: faker.phone.number('+27#########'), // South African format
      preferredLanguage: 'en-ZA',
    });

    const registerUrl = new URL('/api/auth/register', BACKEND_URL);
    const client = registerUrl.protocol === 'https:' ? https : http;

    const req = client.request(registerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 30000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 201) {
          resolve({ email, password, firstName, lastName });
        } else {
          // Log error but don't throw — continue with next user
          console.warn(
            `[!] User ${index}/${COUNT} failed (${res.statusCode}): ` +
            `${body.slice(0, 100)}... Retrying...`
          );
          reject(new Error(`Register failed: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Registration timeout'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Retry wrapper with exponential backoff
 */
async function createPatientWithRetry(index, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await createTestPatient(index);
      process.stdout.write(`\r[✓] Created ${index + 1}/${COUNT} users...`);
      return result;
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`\n[✗] Failed to create user ${index} after ${maxRetries} attempts: ${error.message}`);
        return null;
      }
      // Exponential backoff: 100ms, 200ms, 400ms
      await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
    }
  }
}

/**
 * Main: create all users and save credentials
 */
async function main() {
  try {
    // Validate backend
    console.log('[*] Validating backend connectivity...');
    await validateBackend();
    console.log('[✓] Backend is accessible\n');

    // Create users
    const credentials = [];
    const startTime = Date.now();

    for (let i = 0; i < COUNT; i++) {
      const cred = await createPatientWithRetry(i);
      if (cred) {
        credentials.push(cred);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n\n[✓] Created ${credentials.length}/${COUNT} users in ${duration}s`);

    // Save credentials (DO NOT print to stdout)
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(credentials, null, 2), 'utf-8');
    console.log(`[✓] Credentials saved to ${OUTPUT_FILE}`);
    console.log(`[!] IMPORTANT: Do NOT commit ${OUTPUT_FILE} to version control`);
    console.log(`[!] This file contains test passwords and should be in .gitignore\n`);

    // Success metrics
    console.log('='.repeat(60));
    console.log('Test User Creation Summary');
    console.log('='.repeat(60));
    console.log(`Total Created: ${credentials.length}/${COUNT}`);
    console.log(`Success Rate: ${((credentials.length / COUNT) * 100).toFixed(1)}%`);
    console.log(`Average Time: ${(duration / credentials.length).toFixed(2)}s per user`);
    console.log(`Output File: ${path.resolve(OUTPUT_FILE)}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error(`\n[✗] Fatal error: ${error.message}`);
    process.exit(1);
  }
}

main();

