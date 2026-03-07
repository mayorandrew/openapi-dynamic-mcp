import eslintJs from '@eslint/js';
import eslint from 'eslint/config';
import { configs } from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import jsoncPlugin from 'eslint-plugin-jsonc';
import jsonSchemaValidatorPlugin from 'eslint-plugin-json-schema-validator';

export default eslint.defineConfig(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'get-apis.js',
      'schemas/**',
      '**/*.{yaml,yml}',
    ],
  },
  ...jsoncPlugin.configs['flat/recommended-with-json'],
  ...jsonSchemaValidatorPlugin.configs['flat/recommended'],
  eslintJs.configs.recommended,
  ...configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: config.files ?? ['**/*.{ts,mts,cts,tsx}'],
  })),
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['server.json'],
    rules: {
      'json-schema-validator/no-invalid': 'error',
    },
  },
  {
    files: ['**/*.{js,cjs,mjs}', '**/*.json'],
    ...configs.disableTypeChecked,
  },
  eslintConfigPrettier,
);
