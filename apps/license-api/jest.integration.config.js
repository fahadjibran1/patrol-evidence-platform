/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.integration-spec\\.ts$',
  setupFiles: ['<rootDir>/test/integration/load-test-env.js'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  transformIgnorePatterns: ['/node_modules/', '<rootDir>/test/integration/load-test-env\\.js$'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@patrol/license-core$': '<rootDir>/../../packages/license-core/src/index.ts',
  },
  testEnvironment: 'node',
  testTimeout: 120_000,
  maxWorkers: 1,
};
