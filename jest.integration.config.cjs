module.exports = {
  testEnvironment: "node",
  transform: { "\\.(ts|js)x?$": "ts-jest" },
  verbose: true,
  preset: "ts-jest/presets/default-esm",
  globals: { "ts-jest": { useESM: true } },

  setupFilesAfterEnv: ["<rootDir>/test/setup/integration.setupAfterEnv.ts"],
  /* getting weird open handles from node-fetch
     @see https://github.com/node-fetch/node-fetch/issues/1479 */
  forceExit: true,
  testMatch: ["<rootDir>/test/**/*.spec.ts"],
  testTimeout: 30000,
};
