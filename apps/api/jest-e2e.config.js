/**
 * Separate from jest.config.js on purpose: these tests require a reachable
 * PostgreSQL (via DATABASE_URL) and Redis (via REDIS_URL) — they are never
 * run as part of `pnpm test`, only explicitly via `pnpm test:e2e` once live
 * infrastructure is up.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: "test/e2e/.*\\.e2e-spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  testEnvironment: "node",
  testTimeout: 30000,
  // Jest runs different test FILES in parallel worker processes by default.
  // These E2E files all share one live database, one E2E_PREFIX namespace,
  // and one cleanupAll() that deletes everything under that prefix — safe
  // within a single file (sequential `it` blocks), but not across files run
  // concurrently: one file's afterAll cleanup can delete fixtures another
  // file is still actively using (the exact FK-violation failure this fixes).
  // Forcing one worker makes files run strictly one after another, so a
  // file's cleanup always completes before the next file creates anything.
  maxWorkers: 1,
};
