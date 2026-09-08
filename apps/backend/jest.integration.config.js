/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.integration.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
  globalSetup: "<rootDir>/src/testSetup/globalSetup.js",
  globalTeardown: "<rootDir>/src/testSetup/globalTeardown.js",
  // Integration tests share one real database and run route handlers that
  // touch the same tables — run them one at a time rather than interleaved
  // across parallel workers.
  maxWorkers: 1,
  testTimeout: 20000,
  verbose: true,
  // A fully-wired Express app (Prisma's connection pool, the native
  // pg_ctl-managed postgres process, etc.) reliably leaves some handle
  // open that Jest's natural process-exit detection never resolves, even
  // after every test-specific one (the WebSocket heartbeat interval) is
  // correctly guarded off in index.ts for NODE_ENV==="test". forceExit is
  // standard practice for supertest-style integration tests for exactly
  // this reason — the alternative is chasing individual native-module
  // handles with no guarantee the next one isn't just as unavoidable.
  forceExit: true,
};
