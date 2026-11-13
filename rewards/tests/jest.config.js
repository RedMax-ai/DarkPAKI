/**
 * Jest configuration for the Rewards Platform security test suite.
 *
 * Usage:
 *   npm test                     – run all tests
 *   npx jest tests/idor.test.js  – run a single suite
 */
module.exports = {
  /* Test root */
  rootDir: '..',

  /* Only look for tests inside the tests/ directory */
  testMatch: ['<rootDir>/tests/**/*.test.js'],

  /* Global setup/teardown helpers */
  setupFilesAfterSetup: ['<rootDir>/tests/setup.js'],

  /* DB + row-lock tests can be slow — allow 30 s per test */
  testTimeout: 30_000,

  /* Force sequential execution — tests share the same DB */
  maxWorkers: 1,

  /* Show each individual test result */
  verbose: true,
};
