import { defineConfig, devices } from '@playwright/test';

// Requires `pnpm build` and a PostgreSQL reachable at DATABASE_URL (infra/docker/compose.yml).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3400',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node tests/e2e/serve-api.ts',
      url: 'http://127.0.0.1:3401/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --dir apps/webapp exec next start -p 3400 -H 127.0.0.1',
      url: 'http://127.0.0.1:3400/login',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { WELYVRA_API_URL: 'http://127.0.0.1:3401', NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
