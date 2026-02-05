/**
 * This script directly invokes Prisma's generator, bypassing the CLI's resolution check
 * which doesn't work well with Yarn workspaces where packages are hoisted.
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');
const rootDir = path.resolve(__dirname, '../../..');

console.log('🔄 Generating Prisma client using direct method...');

// Find where @prisma/client is actually located
const findPrismaClient = () => {
  const possiblePaths = [
    path.join(rootDir, 'node_modules/@prisma/client'),
    path.join(rootDir, 'apps/node_modules/@prisma/client'),
    path.join(__dirname, '../node_modules/@prisma/client'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
};

const prismaClientPath = findPrismaClient();
if (!prismaClientPath) {
  console.error('❌ Could not find @prisma/client. Please run: yarn install');
  process.exit(1);
}

console.log(`✅ Found @prisma/client at: ${prismaClientPath}`);

// The solution: run prisma generate from the root directory where @prisma/client is hoisted
// and specify the schema path explicitly
try {
  const command = `npx --yes prisma@6.16.2 generate --schema="${schemaPath}"`;
  console.log(`Running: ${command}`);
  console.log(`From directory: ${rootDir}`);
  
  execSync(command, {
    cwd: rootDir, // Run from root where @prisma/client is hoisted
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      // These might help
      PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
    }
  });
  
  console.log('✅ Prisma client generated successfully!');
} catch (error) {
  console.error('❌ Failed to generate Prisma client');
  console.error(error.message);
  process.exit(1);
}

