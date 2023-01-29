/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  extensionsToTreatAsEsm: [".ts"],
  roots: ["<rootDir>/src"],
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  testEnvironment: "node",
  transform: { "\\.(ts)x?$": ["ts-jest", { useESM: false }] },
  verbose: true,
  moduleNameMapper: { "^src/(.*)$": `<rootDir>/src/$1` },
  collectCoverage: false,
  coverageDirectory: "coverage",
  setupFiles: ["./.env.unit-tests.cjs"],
  testPathIgnorePatterns: ["<rootDir>/src/test"],
};
