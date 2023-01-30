module.exports = {
  testEnvironment: "node",
  transform: { "\\.(ts|js)x?$": "ts-jest" },
  verbose: true,
  setupFilesAfterEnv: ["<rootDir>/src/test/setup/integration.setupAfterEnv.ts"],
  /* getting weird open handles from node-fetch
     @see https://github.com/node-fetch/node-fetch/issues/1479 */
  forceExit: true,
  testMatch: ["<rootDir>/src/test/**/*.spec.ts"],
  testTimeout: 30000,
};
