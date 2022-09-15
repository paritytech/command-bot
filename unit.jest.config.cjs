module.exports = {
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  testEnvironment: "node",
  transform: { "\\.(ts|js)x?$": "ts-jest" },
  verbose: true,
  preset: "ts-jest/presets/default-esm",
  moduleNameMapper: { "^src/(.*)$": `${process.cwd()}/src/$1` },
  globals: { "ts-jest": { useESM: true } },
}
