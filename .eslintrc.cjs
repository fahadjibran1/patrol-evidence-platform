module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 'latest',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', 'node_modules/', 'web/dist/', 'patrol-evidence-platform/'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-require-imports': 'off',
  },
  overrides: [
    {
      files: ['src/database/migrations/*.ts'],
      rules: {
        'no-useless-escape': 'off',
      },
    },
  ],
};
