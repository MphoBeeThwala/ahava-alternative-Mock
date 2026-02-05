/**
 * Wrapper script that patches require.resolve before Prisma runs
 * This allows Prisma to find @prisma/client in Yarn workspaces
 */

const path = require('path');
const Module = require('module');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '../../..');
const prismaClientPath = path.join(rootDir, 'node_modules/@prisma/client');

// Patch require.resolve BEFORE Prisma is loaded
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  // If Prisma is looking for @prisma/client, help it find it
  if (request === '@prisma/client' || request.startsWith('@prisma/client/')) {
    try {
      // Try to resolve from root node_modules
      const resolved = originalResolve.call(this, request, {
        ...parent,
        paths: [path.join(rootDir, 'node_modules'), ...(parent?.paths || [])]
      }, isMain, options);
      return resolved;
    } catch (e) {
      // If that fails, try direct path
      if (request === '@prisma/client') {
        const indexFile = path.join(prismaClientPath, 'index.js');
        if (fs.existsSync(indexFile)) {
          return indexFile;
        }
      }
      // Fall through to original
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

// Also patch require.resolve function
const originalRequireResolve = require.resolve;
require.resolve = function(request, options) {
  if (request === '@prisma/client' || request.startsWith('@prisma/client/')) {
    try {
      return originalRequireResolve.call(this, request, {
        ...options,
        paths: [path.join(rootDir, 'node_modules'), ...(options?.paths || [])]
      });
    } catch (e) {
      if (request === '@prisma/client') {
        const indexFile = path.join(prismaClientPath, 'index.js');
        if (fs.existsSync(indexFile)) {
          return indexFile;
        }
      }
      throw e;
    }
  }
  return originalRequireResolve.call(this, request, options);
};

// Now require and run Prisma CLI
const prismaCliPath = path.join(rootDir, 'node_modules/prisma/build/index.js');
if (fs.existsSync(prismaCliPath)) {
  // Load Prisma CLI
  require(prismaCliPath);
} else {
  console.error('❌ Prisma CLI not found');
  process.exit(1);
}

