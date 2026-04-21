/**
 * Bypass Prisma's @prisma/client resolution check
 * This script temporarily patches require.resolve to allow Prisma generation
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Module = require('module');

const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');
const rootDir = path.resolve(__dirname, '../../..');
const backendDir = path.resolve(__dirname, '..');

console.log('🔄 Generating Prisma client (bypass method)...');
console.log(`Schema: ${schemaPath}`);
console.log(`Root: ${rootDir}`);

// Find where @prisma/client actually is
const prismaClientPath = path.join(rootDir, 'node_modules/@prisma/client');
if (!fs.existsSync(prismaClientPath)) {
  console.error('❌ @prisma/client not found in root node_modules');
  console.error('   Please run: yarn install');
  process.exit(1);
}

console.log(`✅ Found @prisma/client at: ${prismaClientPath}`);

// Patch Module._resolveFilename to allow Prisma to find @prisma/client
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === '@prisma/client' || request.startsWith('@prisma/client/')) {
    // Try to resolve from root node_modules first
    try {
      const resolved = require.resolve(request, { paths: [path.join(rootDir, 'node_modules')] });
      return resolved;
    } catch (e) {
      // Fall through to original
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Also patch require.resolve
const originalRequireResolve = require.resolve;
require.resolve = function(request, options) {
  if (request === '@prisma/client' || request.startsWith('@prisma/client/')) {
    try {
      return require.resolve(request, { 
        ...options, 
        paths: [path.join(rootDir, 'node_modules'), ...(options?.paths || [])] 
      });
    } catch (e) {
      // Fall through
    }
  }
  return originalRequireResolve.call(this, request, options);
};

// Now try to run Prisma generate
// We'll use a child process with the patched environment
const env = {
  ...process.env,
  NODE_PATH: path.join(rootDir, 'node_modules'),
  PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
  // Don't override engine paths - let Prisma find them automatically
};

// Try using the Prisma binary directly
const prismaBin = path.join(rootDir, 'node_modules', '.bin', 'prisma');
const prismaBinCmd = process.platform === 'win32' ? prismaBin + '.cmd' : prismaBin;

if (fs.existsSync(prismaBinCmd)) {
  console.log('✅ Using Prisma binary from node_modules');
  
  const proc = spawn(prismaBinCmd, ['generate', '--schema', schemaPath], {
    cwd: backendDir,
    env: env,
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
    console.error('❌ Error spawning Prisma process:', error.message);
    process.exit(1);
  });
} else {
  // Fallback to npx
  console.log('⚠️  Prisma binary not found, using npx...');
  
  const proc = spawn('npx', ['--yes', 'prisma@6.16.2', 'generate', '--schema', schemaPath], {
    cwd: backendDir,
    env: env,
    stdio: 'inherit',
    shell: true,
  });

  proc.on('close', (code) => {
    if (code === 0) {
      console.log('✅ Prisma client generated successfully!');
      process.exit(0);
    } else {
      console.error(`❌ Prisma generate exited with code ${code}`);
      console.error('💡 The Prisma CLI still checks for @prisma/client before generating.');
      console.error('   This is a known limitation with Yarn workspaces.');
      process.exit(1);
    }
  });

  proc.on('error', (error) => {
    console.error('❌ Error spawning Prisma process:', error.message);
    process.exit(1);
  });
}

