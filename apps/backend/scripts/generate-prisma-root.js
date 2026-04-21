/**
 * Generate Prisma client from root directory
 * This ensures @prisma/client is resolvable during generation
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '../../..');
const backendDir = path.resolve(__dirname, '..');
const schemaPath = path.resolve(backendDir, 'prisma/schema.prisma');

console.log('🔄 Generating Prisma client from root directory...');
console.log(`Root: ${rootDir}`);
console.log(`Schema: ${schemaPath}`);

// Verify @prisma/client exists
const prismaClientPath = path.join(rootDir, 'node_modules/@prisma/client');
if (!fs.existsSync(prismaClientPath)) {
  console.error('❌ @prisma/client not found in root node_modules');
  console.error('   Please run: yarn install');
  process.exit(1);
}

console.log(`✅ Found @prisma/client at: ${prismaClientPath}`);

// Verify schema exists
if (!fs.existsSync(schemaPath)) {
  console.error(`❌ Schema not found: ${schemaPath}`);
  process.exit(1);
}

console.log(`✅ Schema found: ${schemaPath}`);

// Run Prisma generate from root directory
// This ensures @prisma/client is resolvable
const env = {
  ...process.env,
  PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
  // Set working directory context
  PWD: rootDir,
};

const prismaBin = path.join(rootDir, 'node_modules', '.bin', 'prisma');
const prismaBinCmd = process.platform === 'win32' ? prismaBin + '.cmd' : prismaBin;

if (!fs.existsSync(prismaBinCmd)) {
  console.error('❌ Prisma binary not found');
  console.error(`   Expected: ${prismaBinCmd}`);
  process.exit(1);
}

console.log('✅ Running Prisma generate from root...');
console.log(`   Command: ${prismaBinCmd} generate --schema=${schemaPath}`);
console.log(`   CWD: ${rootDir}`);

const proc = spawn(prismaBinCmd, ['generate', '--schema', schemaPath], {
  cwd: rootDir, // Run from root where @prisma/client is available
  env: env,
  stdio: 'inherit',
  shell: true,
});

proc.on('close', (code) => {
  if (code === 0) {
    console.log('✅ Prisma client generated successfully!');
    
    // Verify the client was generated
    const clientPath = path.join(rootDir, 'node_modules/.prisma/client');
    if (fs.existsSync(clientPath)) {
      console.log(`✅ Client verified at: ${clientPath}`);
      
      // Check for new models
      const indexFile = path.join(clientPath, 'index.d.ts');
      if (fs.existsSync(indexFile)) {
        const content = fs.readFileSync(indexFile, 'utf-8');
        if (content.includes('BiometricReading')) {
          console.log('✅ BiometricReading model found in generated client');
        }
        if (content.includes('HealthAlert')) {
          console.log('✅ HealthAlert model found in generated client');
        }
      }
    }
    
    process.exit(0);
  } else {
    console.error(`❌ Prisma generate exited with code ${code}`);
    console.error('💡 This is a known issue with Prisma and Yarn workspaces.');
    console.error('   The system will use raw SQL fallbacks until this is resolved.');
    process.exit(1);
  }
});

proc.on('error', (error) => {
  console.error('❌ Error spawning Prisma process:', error.message);
  process.exit(1);
});

