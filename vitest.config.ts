import { defineConfig } from 'vitest/config';
// Root project: repository-level tests (fixtures, e2e helpers). Packages have their own configs.
export default defineConfig({
  resolve: { conditions: ['source'] },
  test: { include: ['tests/**/*.test.ts'] },
});
