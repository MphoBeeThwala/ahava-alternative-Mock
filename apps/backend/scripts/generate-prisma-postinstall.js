/**
 * Postinstall script to generate Prisma client
 * This runs after yarn install when @prisma/client is definitely available
 */

const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '../../..');
const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');

console.log('🔄 Postinstall: Generating Prisma client...');

try {
  // Use the Prisma binary directly from node_modules
  const prismaBin = path.join(rootDir, 'node_modules/.bin/prisma');
  const prismaBinCmd = process.platform === 'win32' ? prismaBin + '.cmd' : prismaBin;
  
  execSync(`"${prismaBinCmd}" generate --schema="${schemaPath}"`, {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
    },
  });
  
  console.log('✅ Prisma client generated successfully!');
} catch (error) {
  console.warn('⚠️  Prisma client generation failed in postinstall');
  console.warn('   This is expected in Yarn workspaces. The system will use SQL fallbacks.');
  console.warn('   To generate manually, run: yarn workspace @ahava-healthcare/api prisma:generate');
  // Don't fail the install process
  process.exit(0);
}

