import js from '@eslint/js';
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
  {
    rules: {
      // Money must never be a JS number: forbid parseFloat / Number() on amounts by convention,
      // and forbid floating literal arithmetic helpers that hide precision loss.
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'Use bigint amounts.' }],
    },
  },
);
