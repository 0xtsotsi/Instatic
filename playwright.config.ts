import { defineConfig } from '@playwright/test'

const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL ?? 'http://127.0.0.1:5174'
process.env.E2E_PUBLIC_BASE_URL ??= 'http://127.0.0.1:3002'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: '.tmp/playwright-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '.tmp/playwright-report' }],
  ],
  use: {
    baseURL: ADMIN_BASE_URL,
    screenshot: 'only-on-failure',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run e2e:dev',
    url: ADMIN_BASE_URL,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
    timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 500 },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
