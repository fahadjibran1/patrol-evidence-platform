/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '\\.integration-spec\\.ts$'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@patrol/license-core$': '<rootDir>/../../packages/license-core/src/index.ts',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  testEnvironment: 'node',
};
