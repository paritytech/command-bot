/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  extensionsToTreatAsEsm: [".ts"],
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  testEnvironment: "node",
  transform: { "\\.(ts|js)x?$": ["ts-jest"] },
  preset: "ts-jest/presets/default-esm",
  globals: { "ts-jest": { useESM: true } },
  verbose: true,
  moduleNameMapper: { "^src/(.*)$": `${process.cwd()}/src/$1` },
  collectCoverage: false,
  coverageDirectory: "coverage",
  setupFiles: ["./.env.example.cjs"]
}
