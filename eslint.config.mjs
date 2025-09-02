import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.eslint.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        Response: 'readonly', // Node.js 18+ Web API
        fetch: 'readonly', // Node.js 18+ Web API
        URL: 'readonly', // Node.js 18+ Web API
        URLSearchParams: 'readonly', // Node.js 18+ Web API
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      ...tsPlugin.configs['recommended-requiring-type-checking'].rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Configure only-throw-error to be more permissive with Web API objects
      '@typescript-eslint/only-throw-error': ['error', {
        allowThrowingAny: true,
        allowThrowingUnknown: true,
        allowRethrowing: true
      }],
    },
  },
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', 'tests/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/only-throw-error': 'off', // Allow Response objects in tests
      '@typescript-eslint/no-explicit-any': 'off', // Allow any in tests
      '@typescript-eslint/no-unsafe-return': 'off', // Allow unsafe returns in tests
      '@typescript-eslint/no-unsafe-argument': 'off', // Allow unsafe arguments in tests
      '@typescript-eslint/await-thenable': 'off', // Allow await on non-promises in tests
      '@typescript-eslint/restrict-template-expressions': 'off', // Allow template expressions in tests
    },
  },
  {
    ignores: ['node_modules/', 'dist/', '*.js', '*.mjs', '*.cjs', 'tsup.config.ts', 'vitest.config.ts', 'scripts/', 'kuzu-bug-report/'],
  },
];