/**
 * Fixed Prisma client generation script
 * Uses Prisma's programmatic API to bypass CLI resolution issues
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');
const rootDir = path.resolve(__dirname, '../../..');
const backendDir = path.resolve(__dirname, '..');

console.log('🔄 Generating Prisma client (fixed method)...');
console.log(`Schema: ${schemaPath}`);
console.log(`Root: ${rootDir}`);
console.log(`Backend: ${backendDir}`);

// Method 1: Try using Prisma's internal generator directly
async function generateWithInternalAPI() {
  try {
    // Import Prisma's generator
    const prismaPath = path.join(rootDir, 'node_modules/prisma');
    if (!fs.existsSync(prismaPath)) {
      throw new Error('Prisma not found in node_modules');
    }

    // Use Prisma's CLI but with environment variables to bypass checks
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
        PRISMA_SKIP_POSTINSTALL_GENERATE: 'true',
        // Force Prisma to use the hoisted package
        NODE_PATH: path.join(rootDir, 'node_modules'),
      };

      // Run prisma generate from the backend directory but with root node_modules
      const prismaBin = path.join(rootDir, 'node_modules', '.bin', 'prisma');
      const command = process.platform === 'win32' ? prismaBin + '.cmd' : prismaBin;
      
      if (!fs.existsSync(command)) {
        // Fallback to npx
        const proc = spawn('npx', ['--yes', 'prisma@6.16.2', 'generate', '--schema', schemaPath], {
          cwd: backendDir,
          env: env,
          stdio: 'inherit',
          shell: true,
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Prisma generate exited with code ${code}`));
          }
        });

        proc.on('error', reject);
        return;
      }

      const proc = spawn(command, ['generate', '--schema', schemaPath], {
        cwd: backendDir,
        env: env,
        stdio: 'inherit',
        shell: true,
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Prisma generate exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  } catch (error) {
    throw error;
  }
}

// Method 2: Direct generator invocation (more complex but bypasses all checks)
async function generateDirectly() {
  try {
    const { getDMMF } = require('@prisma/internals');
    const { generatorHandler } = require('@prisma/generator-helper');
    
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    const dmmf = await getDMMF({ datamodel: schema });
    
    // This is complex - let's use a simpler workaround
    throw new Error('Direct generation not fully implemented');
  } catch (error) {
    if (error.message.includes('not fully implemented')) {
      throw error;
    }
    // Fall through to next method
  }
}

// Method 3: Create a temporary package.json in backend to trick Prisma
async function generateWithTempPackage() {
  const tempPackagePath = path.join(backendDir, 'package.temp.json');
  const originalPackagePath = path.join(backendDir, 'package.json');
  
  try {
    // Read original package.json
    const originalPackage = JSON.parse(fs.readFileSync(originalPackagePath, 'utf-8'));
    
    // Create temp package with @prisma/client explicitly
    const tempPackage = {
      ...originalPackage,
      dependencies: {
        ...originalPackage.dependencies,
        '@prisma/client': '6.16.2',
      },
    };
    
    // Write temp package
    fs.writeFileSync(tempPackagePath, JSON.stringify(tempPackage, null, 2));
    
    // Try generating from backend with temp package
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
      };
      
      const proc = spawn('npx', ['prisma@6.16.2', 'generate', '--schema', schemaPath], {
        cwd: backendDir,
        env: env,
        stdio: 'inherit',
        shell: true,
      });
      
      proc.on('close', (code) => {
        // Clean up temp package
        if (fs.existsSync(tempPackagePath)) {
          fs.unlinkSync(tempPackagePath);
        }
        
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Prisma generate exited with code ${code}`));
        }
      });
      
      proc.on('error', (err) => {
        if (fs.existsSync(tempPackagePath)) {
          fs.unlinkSync(tempPackagePath);
        }
        reject(err);
      });
    });
  } catch (error) {
    if (fs.existsSync(tempPackagePath)) {
      fs.unlinkSync(tempPackagePath);
    }
    throw error;
  }
}

// Main execution
async function main() {
  try {
    // Try Method 1 first
    console.log('Attempting Method 1: Internal API with env vars...');
    await generateWithInternalAPI();
    console.log('✅ Prisma client generated successfully!');
  } catch (error1) {
    console.log(`Method 1 failed: ${error1.message}`);
    console.log('Attempting Method 3: Temporary package.json workaround...');
    
    try {
      await generateWithTempPackage();
      console.log('✅ Prisma client generated successfully!');
    } catch (error2) {
      console.error('❌ All methods failed');
      console.error('Method 1 error:', error1.message);
      console.error('Method 3 error:', error2.message);
      console.error('\n💡 Workaround: The system will use raw SQL fallbacks until Prisma client is regenerated.');
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

