/** @type {import('eslint').Linter.Config[]} */
const tseslint = require('typescript-eslint');
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules', 'dist', '**/*.cjs'] },
  ...tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: ['**/*.ts'],
      languageOptions: {
        ecmaVersion: 2020,
        globals: globals.node,
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      },
    },
    {
      // AH-07: plain CommonJS test infrastructure (Jest globalSetup/
      // globalTeardown run outside the ts-jest transform, before any test
      // file loads) — Node globals/require, not the TS ruleset above.
      files: ['**/*.js'],
      languageOptions: {
        ecmaVersion: 2020,
        sourceType: 'commonjs',
        globals: globals.node,
      },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    }
  ),
];
