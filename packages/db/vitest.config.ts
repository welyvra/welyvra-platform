import { defineConfig } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';
export default defineConfig({
  ...sourceConditions,
  test: { include: ['src/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 60_000 },
});
