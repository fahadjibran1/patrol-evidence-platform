import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/patrol-evidence-platform', '<rootDir>/dist'],
  testPathIgnorePatterns: ['<rootDir>/patrol-evidence-platform', '<rootDir>/dist'],
  testEnvironment: 'node',
};

export default config;
