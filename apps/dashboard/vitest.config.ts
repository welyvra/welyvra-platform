import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';
export default defineConfig({
  ...sourceConditions,
  resolve: {
    ...sourceConditions.resolve,
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  esbuild: { jsx: 'automatic' },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
