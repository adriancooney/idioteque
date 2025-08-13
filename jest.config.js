module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  projects: [
    {
      displayName: "idioteque",
      rootDir: "<rootDir>/packages/idioteque",
      testMatch: [
        "<rootDir>/src/**/__tests__/**/*.ts",
        "<rootDir>/src/**/?(*.)+(spec|test).ts",
      ],
      transform: {
        "^.+\\.ts$": "ts-jest",
      },
      collectCoverageFrom: [
        "src/**/*.ts",
        "!src/**/*.d.ts",
        "!src/**/*.test.ts",
        "!src/**/*.spec.ts",
      ],
    },
    {
      displayName: "vercel-queue",
      rootDir: "<rootDir>/packages/vercel-queue",
      testMatch: [
        "<rootDir>/src/**/__tests__/**/*.ts",
        "<rootDir>/src/**/?(*.)+(spec|test).ts",
      ],
      transform: {
        "^.+\\.ts$": "ts-jest",
      },
      collectCoverageFrom: [
        "src/**/*.ts",
        "!src/**/*.d.ts",
        "!src/**/*.test.ts",
        "!src/**/*.spec.ts",
      ],
    },
  ],
  collectCoverage: false,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
};
