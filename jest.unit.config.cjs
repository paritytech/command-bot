/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  extensionsToTreatAsEsm: [".ts"],
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  testEnvironment: "node",
  transform: { "\\.(ts|js)x?$": ["ts-jest"] },
  verbose: true,
  moduleNameMapper: { "^src/(.*)$": `${process.cwd()}/src/$1` },
  collectCoverage: false,
  coverageDirectory: "coverage",
  setupFiles: ["./.env.unit-tests.cjs"],
}
