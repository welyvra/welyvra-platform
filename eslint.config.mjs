import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { languageOptions: { globals: { ...globals.node } } },
  {
    rules: {
      // Money is never a JS number. Amounts are bigint (see packages/core/src/amount.ts).
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'Use bigint amounts.' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/src/testing.ts', '**/src/fixtures.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
