const { execSync } = require('child_process');
const path = require('path');

// This script bypasses Prisma's resolution check by using the generator directly
const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');
const outputPath = path.resolve(__dirname, '../../node_modules/.prisma/client');

console.log('🔄 Generating Prisma client...');
console.log(`Schema: ${schemaPath}`);
console.log(`Output: ${outputPath}`);

try {
  // Use Prisma's generate command but with explicit paths
  // The key is to run it from the root where @prisma/client is hoisted
  const rootDir = path.resolve(__dirname, '../../..');
  const prismaCmd = path.join(rootDir, 'node_modules/.bin/prisma');
  
  // Try to use the local prisma if available, otherwise use npx
  const command = `cd "${path.resolve(__dirname, '..')}" && npx --yes prisma@6.16.2 generate --schema="${schemaPath}"`;
  
  execSync(command, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      // Force Prisma to use the hoisted package
      PRISMA_GENERATE_DATAPROXY: 'false',
    }
  });
  
  console.log('✅ Prisma client generated successfully');
} catch (error) {
  console.error('❌ Failed to generate Prisma client');
  console.error(error.message);
  
  // Try alternative: use the Prisma generator directly via require
  try {
    console.log('🔄 Trying alternative method...');
    const { generatorHandler } = require('@prisma/generator-helper');
    const { getDMMF } = require('@prisma/internals');
    const fs = require('fs');
    
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    // This is a simplified approach - in practice, you'd need to call the generator properly
    console.log('⚠️  Alternative method not fully implemented. Please run: yarn workspace @ahava-healthcare/api exec "cd ../.. && npx prisma generate --schema=apps/backend/prisma/schema.prisma"');
  } catch (altError) {
    console.error('❌ Alternative method also failed');
  }
  
  process.exit(1);
}
