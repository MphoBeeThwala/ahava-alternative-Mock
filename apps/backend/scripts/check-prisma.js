/**
 * Check if Prisma client is available and usable
 * If not, provide instructions for manual generation
 */

const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '../../..');
const clientPath = path.join(rootDir, 'node_modules/.prisma/client');

console.log('🔍 Checking Prisma client...');

// Check if client exists
if (fs.existsSync(clientPath)) {
  console.log('✅ Prisma client found at:', clientPath);
  
  // Try to require it
  try {
    const { PrismaClient } = require('@prisma/client');
    console.log('✅ Prisma client is usable');
    console.log('✅ Prisma setup is correct');
    process.exit(0);
  } catch (error) {
    console.log('⚠️  Prisma client exists but may need regeneration:', error.message);
    console.log('   Run: yarn prisma:generate');
    process.exit(1);
  }
} else {
  console.log('❌ Prisma client not found');
  console.log('   Expected at:', clientPath);
  console.log('');
  console.log('   To generate the client, you may need to:');
  console.log('   1. Ensure @prisma/client is installed: yarn install');
  console.log('   2. Run from root: cd ../.. && npx prisma generate --schema=apps/backend/prisma/schema.prisma');
  console.log('   3. Or use the workaround script: yarn prisma:generate');
  process.exit(1);
}

