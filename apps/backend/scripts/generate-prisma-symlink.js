/**
 * Generate Prisma client by creating a temporary symlink to @prisma/client
 * This allows Prisma's CLI to find the package during generation
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');
const rootDir = path.resolve(__dirname, '../../..');
const backendDir = path.resolve(__dirname, '..');

console.log('🔄 Generating Prisma client (symlink method)...');
console.log(`Schema: ${schemaPath}`);
console.log(`Root: ${rootDir}`);

// Find where @prisma/client actually is
const prismaClientSource = path.join(rootDir, 'node_modules/@prisma/client');
const prismaClientTarget = path.join(backendDir, 'node_modules/@prisma/client');
const backendNodeModules = path.join(backendDir, 'node_modules');

if (!fs.existsSync(prismaClientSource)) {
  console.error('❌ @prisma/client not found in root node_modules');
  console.error('   Please run: yarn install');
  process.exit(1);
}

console.log(`✅ Found @prisma/client at: ${prismaClientSource}`);

// Create backend/node_modules if it doesn't exist
if (!fs.existsSync(backendNodeModules)) {
  console.log('Creating backend/node_modules directory...');
  fs.mkdirSync(backendNodeModules, { recursive: true });
}

// Create symlink (or copy on Windows if symlinks don't work)
let symlinkCreated = false;
try {
  if (fs.existsSync(prismaClientTarget)) {
    // Remove existing symlink/file
    const stats = fs.lstatSync(prismaClientTarget);
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(prismaClientTarget);
    } else if (stats.isDirectory()) {
      fs.rmSync(prismaClientTarget, { recursive: true, force: true });
    }
  }
  
  // Try to create symlink
  if (process.platform === 'win32') {
    // On Windows, use junction (directory symlink) or copy
    try {
      // Try junction first (works without admin on Windows)
      fs.symlinkSync(prismaClientSource, prismaClientTarget, 'junction');
      symlinkCreated = true;
      console.log('✅ Created junction link to @prisma/client');
    } catch (symlinkError) {
      // If junction fails, try copying (slower but works)
      console.log('⚠️  Junction failed, copying @prisma/client...');
      fs.cpSync(prismaClientSource, prismaClientTarget, { recursive: true });
      symlinkCreated = true;
      console.log('✅ Copied @prisma/client to backend');
    }
  } else {
    // On Unix, use symlink
    fs.symlinkSync(prismaClientSource, prismaClientTarget, 'dir');
    symlinkCreated = true;
    console.log('✅ Created symlink to @prisma/client');
  }
} catch (error) {
  console.error('❌ Failed to create symlink/copy:', error.message);
  process.exit(1);
}

// Now run Prisma generate
const env = {
  ...process.env,
  PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
};

const prismaBin = path.join(rootDir, 'node_modules', '.bin', 'prisma');
const prismaBinCmd = process.platform === 'win32' ? prismaBin + '.cmd' : prismaBin;

if (fs.existsSync(prismaBinCmd)) {
  console.log('✅ Running Prisma generate...');
  
  const proc = spawn(prismaBinCmd, ['generate', '--schema', schemaPath], {
    cwd: backendDir,
    env: env,
    stdio: 'inherit',
    shell: true,
  });

  proc.on('close', (code) => {
    // Clean up symlink/copy
    try {
      if (fs.existsSync(prismaClientTarget)) {
        const stats = fs.lstatSync(prismaClientTarget);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(prismaClientTarget);
        } else if (stats.isDirectory()) {
          fs.rmSync(prismaClientTarget, { recursive: true, force: true });
        }
        console.log('✅ Cleaned up temporary symlink/copy');
      }
    } catch (cleanupError) {
      console.warn('⚠️  Failed to clean up symlink/copy:', cleanupError.message);
    }
    
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
  console.error('❌ Prisma binary not found');
  process.exit(1);
}

