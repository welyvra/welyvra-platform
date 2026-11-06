import { defineConfig } from 'vitest/config';
import { sourceConditions } from './vitest.shared.js';
// Root project: repository-level tests (fixtures, e2e helpers). Packages have their own configs.
export default defineConfig({ ...sourceConditions, test: { include: ['tests/**/*.test.ts'] } });
