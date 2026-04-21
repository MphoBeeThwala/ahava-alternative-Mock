/**
 * Final attempt: Use wrapper script to patch require.resolve
 */

const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '../../..');
const backendDir = path.resolve(__dirname, '..');
const schemaPath = path.resolve(backendDir, 'prisma/schema.prisma');
const wrapperPath = path.resolve(__dirname, 'prisma-wrapper.js');

console.log('🔄 Generating Prisma client (final method with wrapper)...');
console.log(`Schema: ${schemaPath}`);

// Use node to run the wrapper, which will then run Prisma
const proc = spawn('node', [wrapperPath, 'generate', '--schema', schemaPath], {
  cwd: rootDir,
  env: {
    ...process.env,
    PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
  },
  stdio: 'inherit',
  shell: true,
});

proc.on('close', (code) => {
  if (code === 0) {
    console.log('✅ Prisma client generated successfully!');
    process.exit(0);
  } else {
    console.error(`❌ Prisma generate exited with code ${code}`);
    process.exit(1);
  }
});

proc.on('error', (error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});

